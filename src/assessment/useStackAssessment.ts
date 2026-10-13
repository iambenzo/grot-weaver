import { Dispatch, SetStateAction, useEffect, useState } from 'react';
import { proxyGet } from '../datasources/proxy';
import { createLimiter } from '../datasources/limiter';
import { scoreInventory } from '../api/score';
import { fetchMetricsNeedingLabels, fetchSpanGroupRules } from '../api/catalogue';
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

export interface Keyed<K, V> {
  key: K;
  value: V;
}

export type Load =
  | { status: 'loading'; progress: DatasourceProgress[]; labels?: LabelProgress }
  | { status: 'failed'; message: string; progress: DatasourceProgress[] }
  | {
      status: 'ready';
      assessment: StackAssessment;
      window: QueryWindow;
      progress: DatasourceProgress[];
      labels?: LabelProgress;
      retry: (uid: string) => void;
    };

interface RunState {
  progress: DatasourceProgress[];
  labels?: LabelProgress;
  assessment?: StackAssessment;
  message?: string;
}

interface RetryRequest {
  uid: string;
  base: StackAssessment;
}

type Start = (deps: StackDependencies) => Promise<StackAssessment>;

export function useStackAssessment(settings: PluginSettings, window: QueryWindow): Load {
  const [run, setRun] = useState<Keyed<QueryWindow, RunState>>();
  const [retryRequest, setRetryRequest] = useState<Keyed<QueryWindow, RetryRequest>>();

  useEffect(
    () => startRun(window, settings, setRun, (deps) => assessStack(discoverStack(settings), window, settings, deps)),
    [settings, window]
  );
  useEffect(() => {
    if (!retryRequest || retryRequest.key !== window) {
      return;
    }
    const { uid, base } = retryRequest.value;
    return startRun(window, settings, setRun, (deps) => retryDatasource(base, uid, window, settings, deps));
  }, [retryRequest, settings, window]);

  const state = run?.key === window ? run.value : { progress: [] };
  if (state.assessment) {
    const base = state.assessment;
    return {
      status: 'ready',
      assessment: base,
      window,
      progress: state.progress,
      labels: state.labels,
      retry: (uid) => setRetryRequest({ key: window, value: { uid, base } }),
    };
  }
  if (state.message !== undefined) {
    return { status: 'failed', message: state.message, progress: state.progress };
  }
  return { status: 'loading', progress: state.progress, labels: state.labels };
}

function startRun(
  window: QueryWindow,
  settings: PluginSettings,
  setRun: Dispatch<SetStateAction<Keyed<QueryWindow, RunState> | undefined>>,
  start: Start
): () => void {
  let cancelled = false;
  const patch = (update: Partial<RunState>) =>
    !cancelled &&
    setRun((current) => ({
      key: window,
      value: { ...(current?.key === window ? current.value : { progress: [] }), ...update },
    }));
  start({
    get: proxyGet,
    limit: createLimiter(concurrencyFrom(settings)),
    score: scoreInventory,
    spanGroupRules: fetchSpanGroupRules,
    namesNeedingLabels: fetchMetricsNeedingLabels,
    onLabelProgress: (labels) => patch({ labels }),
    onProgress: (progress) => patch({ progress }),
    onPartial: (assessment) => patch({ assessment }),
  })
    .then((assessment) => patch({ assessment, progress: assessment.progress, message: undefined }))
    .catch((error: unknown) => patch({ message: messageOf(error) }));
  return () => {
    cancelled = true;
  };
}

export function loadingText(load: { labels?: LabelProgress }): string {
  const labels =
    load.labels && load.labels.total > 0 ? ` Checking metric labels ${load.labels.done}/${load.labels.total}.` : '';
  return `Collecting telemetry names and scoring them…${labels}`;
}

export function messageOf(error: unknown): string {
  if (error && typeof error === 'object') {
    const candidate = error as { data?: { error?: string; message?: string }; message?: string };
    return candidate.data?.error ?? candidate.data?.message ?? candidate.message ?? 'unknown error';
  }
  return String(error);
}
