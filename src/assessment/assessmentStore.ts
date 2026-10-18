import { createProxyGet } from '../datasources/proxy';
import { Inventory } from '../inventory/types';
import { createLimiter } from '../datasources/limiter';
import { scoreInventory } from '../api/score';
import { fetchMetricsNeedingLabels, fetchRenamedAttributes, fetchSpanGroupRules } from '../api/catalogue';
import { fetchProducts } from '../api/products';
import { LabelProgress } from '../inventory/prometheus';
import { PluginSettings, concurrencyFrom } from '../settings/settings';
import { QueryWindow } from '../window/window';
import { SavedResults, noSavedResults } from './savedResults';
import { messageOf } from '../api/errors';
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
  savedAtMs?: number;
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
  service?: string;
  startedAtMs: number;
  running: number;
  controller: AbortController;
  listeners: Set<Listener>;
  queue: Promise<void>;
  queuedRetries: Set<string>;
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

export function runKey(settings: PluginSettings, rawRange: { from: unknown; to: unknown }, service?: string): string {
  return JSON.stringify([String(rawRange.from), String(rawRange.to), settings, service ?? null]);
}

export function createAssessmentStore(
  dependencies: DependencyFactory = browserDependencies,
  nowMs: () => number = Date.now,
  saved: SavedResults = noSavedResults
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

  const execute = (run: ActiveRun, begin: Start, fromSaved = false) =>
    begin({
      ...dependencies(run.settings, run.controller.signal),
      service: run.service,
      onLabelProgress: (labels) => patch(run, { labels }),
      onProgress: (progress) => patch(run, { progress }),
      onPartial: (assessment) => run.state.savedAtMs === undefined && patch(run, { assessment }),
    })
      .then((assessment) => {
        if (fromSaved) {
          patch(run, { assessment, progress: assessment.progress, message: undefined });
          return;
        }
        patch(run, { assessment, progress: assessment.progress, message: undefined, savedAtMs: undefined });
        if (run.service === undefined && !assessment.partial && !run.controller.signal.aborted) {
          void saved.save(run.key, assessment);
        }
      })
      .catch((error: unknown) => patch(run, { message: messageOf(error) }));

  const enqueue = (
    run: ActiveRun,
    next: () => { begin: Start; fromSaved: boolean } | undefined,
    settled: () => void = () => undefined
  ) => {
    const idle = run.running === 0;
    run.running++;
    const step = () => {
      const planned = next();
      return planned && !run.controller.signal.aborted ? execute(run, planned.begin, planned.fromSaved) : undefined;
    };
    run.queue = (idle ? Promise.resolve(step()) : run.queue.then(step)).finally(() => {
      run.running--;
      settled();
    });
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
    acquire(key: string, window: QueryWindow, settings: PluginSettings, service?: string): Run {
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
        service,
        state: { progress: [] },
        startedAtMs: nowMs(),
        running: 0,
        controller: new AbortController(),
        listeners: new Set(),
        queue: Promise.resolve(),
        queuedRetries: new Set(),
      };
      current = run;
      enqueue(run, () => ({
        begin: (deps) => assessStack(discoverStack(settings), window, settings, deps),
        fromSaved: false,
      }));
      if (service === undefined) {
        void saved.load(key).then((found) => {
          if (found && (run.state.assessment === undefined || run.state.assessment.partial)) {
            patch(run, {
              assessment: found.assessment,
              progress: found.assessment.progress,
              savedAtMs: found.savedAtMs,
            });
          }
        });
      }
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
      if (active.controller.signal.aborted || active.queuedRetries.has(uid)) {
        return;
      }
      active.queuedRetries.add(uid);
      enqueue(
        active,
        () => {
          const base = active.state.assessment;
          return (
            base && {
              begin: (deps) => retryDatasource(base, uid, active.window, active.settings, deps),
              fromSaved: active.state.savedAtMs !== undefined,
            }
          );
        },
        () => active.queuedRetries.delete(uid)
      );
    },
  };
}

export type AssessmentStore = ReturnType<typeof createAssessmentStore>;
