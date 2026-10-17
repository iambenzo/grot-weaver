import { useEffect, useState } from 'react';
import { TimeRange } from '@grafana/data';
import { LabelProgress } from '../inventory/prometheus';
import { PluginSettings } from '../settings/settings';
import { QueryWindow, toQueryWindow } from '../window/window';
import { DatasourceProgress, StackAssessment } from './stackAssessment';
import { AssessmentStore, Run, RunState, createAssessmentStore, runKey } from './assessmentStore';

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
    };

const sharedStore = createAssessmentStore();

export function useStackAssessment(
  settings: PluginSettings,
  timeRange: TimeRange,
  store: AssessmentStore = sharedStore
): Load {
  const key = runKey(settings, timeRange.raw);
  const [snapshot, setSnapshot] = useState<Keyed<string, { run: Run; state: RunState }>>();

  useEffect(() => {
    const run = store.acquire(key, toQueryWindow(timeRange), settings);
    const update = () => setSnapshot({ key, value: { run, state: run.state } });
    update();
    return store.subscribe(run, update);
  }, [key, settings, timeRange, store]);

  if (!snapshot || snapshot.key !== key) {
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
    };
  }
  if (state.message !== undefined) {
    return { status: 'failed', message: state.message, progress: state.progress };
  }
  return { status: 'loading', progress: state.progress, labels: state.labels };
}

export function loadingText(load: { labels?: LabelProgress }): string {
  const labels =
    load.labels && load.labels.total > 0 ? ` Checking metric labels ${load.labels.done}/${load.labels.total}.` : '';
  return `Collecting telemetry names and scoring them…${labels}`;
}
