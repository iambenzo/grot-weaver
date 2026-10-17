import { ProxyGet } from '../datasources/proxy';
import { Limiter } from '../datasources/limiter';
import { QueryWindow, tempoWindowParams } from '../window/window';

const QUERY_RANGE_PATH = '/api/metrics/query_range';
const MAX_DURATION_PATTERN = /maximum allowed duration of ((?:\d+(?:\.\d+)?(?:h|ms|m|s))+)/;
const DURATION_PART_PATTERN = /(\d+(?:\.\d+)?)(h|ms|m|s)/g;
const SECONDS_PER_UNIT: Record<string, number> = { h: 3600, m: 60, s: 1, ms: 0.001 };
const STEPS_PER_WINDOW = 20;
const MIN_STEP_SECONDS = 60;
const SLICE_HEADROOM = 0.8;

export interface MetricsAttribute {
  key: string;
  value?: { stringValue?: string };
}

export interface MetricsSample {
  timestampMs?: string;
  value?: number;
}

export interface MetricsSeries {
  labels?: MetricsAttribute[];
  samples?: MetricsSample[];
}

const MISSING_VALUE = 'nil';

export function labelValue(labels: MetricsAttribute[] | undefined, key: string): string {
  const value = labels?.find((label) => label.key === key)?.value?.stringValue ?? '';
  return value === MISSING_VALUE ? '' : value;
}

export function spanTotal(series: MetricsSeries): number {
  return (series.samples ?? []).reduce((total, sample) => total + (sample.value ?? 0), 0);
}

export interface MetricsQueryContext {
  uid: string;
  get: ProxyGet;
  limit: Limiter;
  window: QueryWindow;
}

export async function queryMetricsRange(
  context: MetricsQueryContext,
  query: string,
  maxSlices = Number.POSITIVE_INFINITY
): Promise<MetricsSeries[]> {
  try {
    return await querySlice(context, query, context.window);
  } catch (error) {
    const maxDurationSeconds = maxDurationOf(error);
    const slices = maxDurationSeconds ? sliceWindow(context.window, maxDurationSeconds) : [];
    if (slices.length === 0 || slices.length > maxSlices) {
      throw error;
    }
    const results = await Promise.all(slices.map((slice) => querySlice(context, query, slice)));
    return mergeSeries(results.flat());
  }
}

export function sliceWindow(window: QueryWindow, maxDurationSeconds: number): QueryWindow[] {
  const sliceSeconds = Math.floor(maxDurationSeconds * SLICE_HEADROOM);
  if (sliceSeconds < 1) {
    return [];
  }
  const slices: QueryWindow[] = [];
  for (let start = window.startSeconds; start < window.endSeconds; start += sliceSeconds) {
    slices.push({ startSeconds: start, endSeconds: Math.min(start + sliceSeconds, window.endSeconds) });
  }
  return slices;
}

export function maxDurationOf(error: unknown): number | undefined {
  const match = MAX_DURATION_PATTERN.exec(responseText(error));
  if (!match) {
    return undefined;
  }
  let seconds = 0;
  for (const [, amount, unit] of match[1].matchAll(DURATION_PART_PATTERN)) {
    seconds += Number(amount) * SECONDS_PER_UNIT[unit];
  }
  return seconds > 0 ? seconds : undefined;
}

export function stepFor(window: QueryWindow): number {
  return Math.max(Math.ceil((window.endSeconds - window.startSeconds) / STEPS_PER_WINDOW), MIN_STEP_SECONDS);
}

async function querySlice(context: MetricsQueryContext, query: string, slice: QueryWindow): Promise<MetricsSeries[]> {
  const params = { ...tempoWindowParams(slice), q: query, step: `${stepFor(slice)}s` };
  const response = await context.limit(() =>
    context.get<{ series?: MetricsSeries[] }>(context.uid, QUERY_RANGE_PATH, params)
  );
  return response.series ?? [];
}

function mergeSeries(series: MetricsSeries[]): MetricsSeries[] {
  const merged = new Map<string, MetricsSeries>();
  for (const entry of series) {
    const key = JSON.stringify(entry.labels ?? []);
    const existing = merged.get(key);
    if (existing) {
      existing.samples = [...(existing.samples ?? []), ...(entry.samples ?? [])];
      continue;
    }
    merged.set(key, { labels: entry.labels, samples: [...(entry.samples ?? [])] });
  }
  return [...merged.values()];
}

function responseText(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return String(error ?? '');
  }
  const candidate = error as { data?: unknown; message?: string };
  if (typeof candidate.data === 'string') {
    return candidate.data;
  }
  const dataMessage = (candidate.data as { message?: unknown } | undefined)?.message;
  return typeof dataMessage === 'string' ? dataMessage : (candidate.message ?? '');
}
