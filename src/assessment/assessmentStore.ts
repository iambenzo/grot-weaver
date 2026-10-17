import { createProxyGet } from '../datasources/proxy';
import { Inventory } from '../inventory/types';
import { createLimiter } from '../datasources/limiter';
import { scoreInventory } from '../api/score';
import { fetchMetricsNeedingLabels, fetchRenamedAttributes, fetchSpanGroupRules } from '../api/catalogue';
import { fetchProducts } from '../api/products';
import { LabelProgress } from '../inventory/prometheus';
import { PluginSettings, concurrencyFrom } from '../settings/settings';
import { QueryWindow } from '../window/window';
import {
  DatasourceProgress,
  StackAssessment,
  StackDependencies,
  assessStack,
  discoverStack,
  retryDatasource,
} from './stackAssessment';

export const MAX_REUSE_MS = 10 * 60 * 1000;
export const ABANDON_GRACE_MS = 5000;

export interface RunState {
  progress: DatasourceProgress[];
  labels?: LabelProgress;
  assessment?: StackAssessment;
  message?: string;
}

export interface Run {
  key: string;
  window: QueryWindow;
  state: RunState;
}

type Start = (deps: StackDependencies) => Promise<StackAssessment>;
type Listener = () => void;

interface ActiveRun extends Run {
  settings: PluginSettings;
  startedAtMs: number;
  running: number;
  controller: AbortController;
  listeners: Set<Listener>;
  abandonTimer?: ReturnType<typeof setTimeout>;
}

export type DependencyFactory = (
  settings: PluginSettings,
  signal: AbortSignal
) => Omit<StackDependencies, 'onLabelProgress' | 'onProgress' | 'onPartial'>;

export function browserDependencies(settings: PluginSettings, signal: AbortSignal) {
  return {
    get: createProxyGet(signal),
    limit: createLimiter(concurrencyFrom(settings)),
    score: (inventory: Inventory, volumeWeighted: boolean) => scoreInventory(inventory, volumeWeighted, signal),
    spanGroupRules: fetchSpanGroupRules,
    namesNeedingLabels: fetchMetricsNeedingLabels,
    renamedAttributes: fetchRenamedAttributes,
    products: fetchProducts,
  };
}

export function runKey(settings: PluginSettings, rawRange: { from: unknown; to: unknown }): string {
  return JSON.stringify([String(rawRange.from), String(rawRange.to), settings]);
}

export function createAssessmentStore(
  dependencies: DependencyFactory = browserDependencies,
  nowMs: () => number = Date.now
) {
  let current: ActiveRun | undefined;

  const notify = (run: ActiveRun) => run.listeners.forEach((listener) => listener());

  const patch = (run: ActiveRun, update: Partial<RunState>) => {
    if (run.controller.signal.aborted) {
      return;
    }
    run.state = { ...run.state, ...update };
    notify(run);
  };

  const start = (run: ActiveRun, begin: Start) => {
    run.running++;
    begin({
      ...dependencies(run.settings, run.controller.signal),
      onLabelProgress: (labels) => patch(run, { labels }),
      onProgress: (progress) => patch(run, { progress }),
      onPartial: (assessment) => patch(run, { assessment }),
    })
      .then((assessment) => patch(run, { assessment, progress: assessment.progress, message: undefined }))
      .catch((error: unknown) => patch(run, { message: messageOf(error) }))
      .finally(() => run.running--);
  };

  const abandon = (run: ActiveRun) => {
    clearTimeout(run.abandonTimer);
    run.controller.abort();
    if (current === run) {
      current = undefined;
    }
  };

  const reusable = (run: ActiveRun | undefined, key: string): run is ActiveRun =>
    run !== undefined && run.key === key && (run.running > 0 || nowMs() - run.startedAtMs < MAX_REUSE_MS);

  return {
    acquire(key: string, window: QueryWindow, settings: PluginSettings): Run {
      if (reusable(current, key)) {
        clearTimeout(current.abandonTimer);
        return current;
      }
      if (current) {
        abandon(current);
      }
      const run: ActiveRun = {
        key,
        window,
        settings,
        state: { progress: [] },
        startedAtMs: nowMs(),
        running: 0,
        controller: new AbortController(),
        listeners: new Set(),
      };
      current = run;
      start(run, (deps) => assessStack(discoverStack(settings), window, settings, deps));
      return run;
    },

    subscribe(run: Run, listener: Listener): () => void {
      const active = run as ActiveRun;
      active.listeners.add(listener);
      clearTimeout(active.abandonTimer);
      return () => {
        active.listeners.delete(listener);
        if (active.listeners.size === 0 && active.running > 0) {
          active.abandonTimer = setTimeout(() => active.listeners.size === 0 && abandon(active), ABANDON_GRACE_MS);
        }
      };
    },

    retry(run: Run, uid: string) {
      const active = run as ActiveRun;
      const base = active.state.assessment;
      if (!base || active.controller.signal.aborted) {
        return;
      }
      start(active, (deps) => retryDatasource(base, uid, active.window, active.settings, deps));
    },
  };
}

export type AssessmentStore = ReturnType<typeof createAssessmentStore>;

export function messageOf(error: unknown): string {
  if (error && typeof error === 'object') {
    const candidate = error as { data?: { error?: string; message?: string }; message?: string };
    return candidate.data?.error ?? candidate.data?.message ?? candidate.message ?? 'unknown error';
  }
  return String(error);
}
