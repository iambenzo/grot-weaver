import { ProxyGet } from '../datasources/proxy';
import { Limiter } from '../datasources/limiter';
import { QueryWindow, tempoWindowParams } from '../window/window';

const QUERY_RANGE_PATH = '/api/metrics/query_range';
const MAX_DURATION_PATTERN = /maximum allowed duration of ((?:\d+(?:\.\d+)?(?:h|ms|m|s))+)/;
const ALLOWED_RANGE_PATTERN = /the allowed range for tenant \S+ is ((?:\d+(?:\.\d+)?(?:h|ms|m|s))+)/;
const DURATION_PART_PATTERN = /(\d+(?:\.\d+)?)(h|ms|m|s)/g;
const SECONDS_PER_UNIT: Record<string, number> = { h: 3600, m: 60, s: 1, ms: 0.001 };
const STEPS_PER_WINDOW = 20;
const MIN_STEP_SECONDS = 60;
const BUCKETS_PER_SLICE = 16;
const ALIGNMENT_STEPS = 3;
const ROUND_STEP_SECONDS = 60;
const MAX_BUCKETS_PER_SLICE = 1000;

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

interface SliceBudget {
  remainingSlices: number;
}

export async function queryMetricsRange(
  context: MetricsQueryContext,
  query: string,
  maxSlices = Number.POSITIVE_INFINITY
): Promise<MetricsSeries[]> {
  try {
    return await querySlice(context, query, context.window, stepFor(context.window));
  } catch (error) {
    const owned = await querySplit(context, query, context.window, error, undefined, { remainingSlices: maxSlices });
    return mergeSeries(owned);
  }
}

async function querySplit(
  context: MetricsQueryContext,
  query: string,
  window: QueryWindow,
  rejection: unknown,
  parentStepSeconds: number | undefined,
  budget: SliceBudget
): Promise<MetricsSeries[]> {
  const allowedSeconds = allowedRangeOf(rejection);
  const stepSeconds = allowedSeconds === undefined ? 0 : sliceStepFor(allowedSeconds, parentStepSeconds);
  const slices =
    allowedSeconds === undefined || stepSeconds < 1 ? [] : sliceWindow(window, allowedSeconds, stepSeconds);
  if (slices.length < 2 || slices.length > budget.remainingSlices) {
    throw rejection;
  }
  budget.remainingSlices -= slices.length;
  const results = await Promise.all(slices.map((slice) => queryOwnedSlice(context, query, slice, stepSeconds, budget)));
  return results.flat();
}

async function queryOwnedSlice(
  context: MetricsQueryContext,
  query: string,
  slice: QueryWindow,
  stepSeconds: number,
  budget: SliceBudget
): Promise<MetricsSeries[]> {
  try {
    const series = await querySlice(context, query, slice, stepSeconds);
    return series.map((entry) => ({ ...entry, samples: ownedSamples(entry.samples ?? [], slice, context.window) }));
  } catch (error) {
    return querySplit(context, query, slice, error, stepSeconds, budget);
  }
}

function ownedSamples(samples: MetricsSample[], slice: QueryWindow, window: QueryWindow): MetricsSample[] {
  const ownsFrom = slice.startSeconds > window.startSeconds ? slice.startSeconds : Number.NEGATIVE_INFINITY;
  const ownsUntil = slice.endSeconds < window.endSeconds ? slice.endSeconds : Number.POSITIVE_INFINITY;
  return samples.filter((sample) => {
    const bucketEndSeconds = Number(sample.timestampMs) / 1000;
    return bucketEndSeconds > ownsFrom && bucketEndSeconds <= ownsUntil;
  });
}

export function sliceStepFor(allowedSeconds: number, parentStepSeconds?: number): number {
  const fittingSeconds = Math.floor(allowedSeconds / (BUCKETS_PER_SLICE + ALIGNMENT_STEPS));
  const roundedSeconds =
    fittingSeconds >= ROUND_STEP_SECONDS ? fittingSeconds - (fittingSeconds % ROUND_STEP_SECONDS) : fittingSeconds;
  return parentStepSeconds === undefined ? roundedSeconds : largestDivisorUpTo(parentStepSeconds, roundedSeconds);
}

function largestDivisorUpTo(value: number, limit: number): number {
  for (let divisor = Math.min(value, limit); divisor >= 1; divisor--) {
    if (value % divisor === 0) {
      return divisor;
    }
  }
  return 0;
}

export function sliceWindow(window: QueryWindow, allowedSeconds: number, stepSeconds: number): QueryWindow[] {
  const fittingSteps = Math.floor((allowedSeconds - ALIGNMENT_STEPS * stepSeconds) / stepSeconds);
  const sliceSeconds = Math.min(fittingSteps, MAX_BUCKETS_PER_SLICE) * stepSeconds;
  if (sliceSeconds < stepSeconds) {
    return [];
  }
  const slices: QueryWindow[] = [];
  let start = window.startSeconds;
  let cut = start - (start % stepSeconds) + sliceSeconds;
  while (start < window.endSeconds) {
    slices.push({ startSeconds: start, endSeconds: Math.min(cut, window.endSeconds) });
    start = cut;
    cut += sliceSeconds;
  }
  return slices;
}

export function allowedRangeOf(error: unknown): number | undefined {
  const text = responseText(error);
  const limits = [MAX_DURATION_PATTERN, ALLOWED_RANGE_PATTERN].flatMap((pattern) =>
    [...text.matchAll(new RegExp(pattern.source, 'g'))].map((match) => secondsOf(match[1]))
  );
  const known = limits.filter((seconds) => seconds > 0);
  return known.length > 0 ? Math.min(...known) : undefined;
}

export function durationMatching(error: unknown, pattern: RegExp): number | undefined {
  const match = pattern.exec(responseText(error));
  const seconds = match ? secondsOf(match[1]) : 0;
  return seconds > 0 ? seconds : undefined;
}

function secondsOf(duration: string): number {
  let seconds = 0;
  for (const [, amount, unit] of duration.matchAll(DURATION_PART_PATTERN)) {
    seconds += Number(amount) * SECONDS_PER_UNIT[unit];
  }
  return seconds;
}

export function stepFor(window: QueryWindow): number {
  return Math.max(Math.ceil((window.endSeconds - window.startSeconds) / STEPS_PER_WINDOW), MIN_STEP_SECONDS);
}

async function querySlice(
  context: MetricsQueryContext,
  query: string,
  slice: QueryWindow,
  stepSeconds: number
): Promise<MetricsSeries[]> {
  const params = { ...tempoWindowParams(slice), q: query, step: `${stepSeconds}s` };
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
