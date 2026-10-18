import { useEffect, useState } from 'react';
import { TimeRange } from '@grafana/data';
import { LabelProgress } from '../inventory/prometheus';
import { PluginSettings } from '../settings/settings';
import { QueryWindow, toQueryWindow } from '../window/window';
import { DatasourceProgress, StackAssessment, mergeOwners } from './stackAssessment';
import { AssessmentStore, Run, RunState, browserDependencies, createAssessmentStore, runKey } from './assessmentStore';
import { browserSavedResults, currentViewer, viewerId } from './savedResults';

export { messageOf } from './assessmentStore';

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
      savedAtMs?: number;
      refreshError?: string;
    };

const sharedStore = createAssessmentStore(browserDependencies, Date.now, browserSavedResults());
const quickStore = createAssessmentStore();

export interface AssessmentOptions {
  store?: AssessmentStore;
  service?: string;
  enabled?: boolean;
}

export function useStackAssessment(
  settings: PluginSettings,
  timeRange: TimeRange,
  { store = sharedStore, service, enabled = true }: AssessmentOptions = {}
): Load {
  const key = `${viewerId(currentViewer()) ?? 'anonymous'}|${runKey(settings, timeRange.raw, service)}`;
  const [snapshot, setSnapshot] = useState<Keyed<string, { run: Run; state: RunState }>>();

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const run = store.acquire(key, toQueryWindow(timeRange), settings, service);
    const update = () => setSnapshot({ key, value: { run, state: run.state } });
    update();
    return store.subscribe(run, update);
  }, [key, settings, timeRange, store, service, enabled]);

  if (!enabled || !snapshot || snapshot.key !== key) {
    return { status: 'loading', progress: [] };
  }
  const { run, state } = snapshot.value;
  if (state.assessment) {
    return {
      status: 'ready',
      assessment: state.assessment,
      window: run.window,
      progress: state.progress,
      labels: state.labels,
      retry: (uid) => store.retry(run, uid),
      savedAtMs: state.savedAtMs,
      refreshError: state.savedAtMs !== undefined ? state.message : undefined,
    };
  }
  if (state.message !== undefined) {
    return { status: 'failed', message: state.message, progress: state.progress };
  }
  return { status: 'loading', progress: state.progress, labels: state.labels };
}

export interface ServiceLoad {
  load: Load;
  quick: boolean;
}

export function chooseServiceLoad(full: Load, quick: Load, preferQuick = false): ServiceLoad {
  const complete = (load: Load) => load.status === 'ready' && !load.assessment.partial;
  if (preferQuick && complete(quick)) {
    return { load: quick, quick: true };
  }
  if (complete(full) || full.status === 'failed' || !complete(quick)) {
    return { load: full, quick: false };
  }
  return { load: quick, quick: true };
}

export function useServiceAssessment(
  settings: PluginSettings,
  timeRange: TimeRange,
  service: string | undefined,
  namespace: string | undefined,
  store: AssessmentStore = sharedStore,
  quickLane: AssessmentStore = quickStore
): ServiceLoad {
  const full = useStackAssessment(settings, timeRange, { store });
  const fullComplete = full.status === 'ready' && !full.assessment.partial;
  const savedLacksService =
    full.status === 'ready' &&
    full.savedAtMs !== undefined &&
    service !== undefined &&
    !mergeOwners(full.assessment.result).some(
      (identity) => identity.owner.name === service && (identity.owner.namespace ?? '') === (namespace ?? '')
    );
  const quick = useStackAssessment(settings, timeRange, {
    store: quickLane,
    service,
    enabled: service !== undefined && (!fullComplete || savedLacksService),
  });
  return chooseServiceLoad(full, quick, savedLacksService);
}

export function loadingText(load: { labels?: LabelProgress }): string {
  const labels =
    load.labels && load.labels.total > 0 ? ` Checking metric labels ${load.labels.done}/${load.labels.total}.` : '';
  return `Collecting telemetry names and scoring them…${labels}`;
}
