import { useEffect, useState } from 'react';
import { proxyGet } from '../datasources/proxy';
import { createLimiter } from '../datasources/limiter';
import { scoreInventory } from '../api/score';
import { fetchMetricsNeedingLabels, fetchSpanGroupRules } from '../api/catalogue';
import { LabelProgress } from '../inventory/prometheus';
import { PluginSettings, concurrencyFrom } from '../settings/settings';
import { QueryWindow } from '../window/window';
import { StackAssessment, assessStack, discoverStack } from './stackAssessment';

export interface Keyed<K, V> {
  key: K;
  value: V;
}

export type Outcome =
  { status: 'failed'; message: string } | { status: 'ready'; assessment: StackAssessment; window: QueryWindow };
export type Load = { status: 'loading'; labels?: LabelProgress } | Outcome;

export function useStackAssessment(settings: PluginSettings, window: QueryWindow): Load {
  const [loaded, setLoaded] = useState<Keyed<QueryWindow, Outcome>>();
  const [progress, setProgress] = useState<Keyed<QueryWindow, LabelProgress>>();
  useEffect(() => {
    let cancelled = false;
    const settle = (value: Outcome) => !cancelled && setLoaded({ key: window, value });
    assessStack(discoverStack(settings), window, settings, {
      get: proxyGet,
      limit: createLimiter(concurrencyFrom(settings)),
      score: scoreInventory,
      spanGroupRules: fetchSpanGroupRules,
      namesNeedingLabels: fetchMetricsNeedingLabels,
      onLabelProgress: (value) => !cancelled && setProgress({ key: window, value }),
    })
      .then((assessment) => settle({ status: 'ready', assessment, window }))
      .catch((error: unknown) => settle({ status: 'failed', message: messageOf(error) }));
    return () => {
      cancelled = true;
    };
  }, [settings, window]);
  if (loaded && loaded.key === window) {
    return loaded.value;
  }
  return { status: 'loading', labels: progress?.key === window ? progress.value : undefined };
}

export function loadingText(load: Extract<Load, { status: 'loading' }>): string {
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
