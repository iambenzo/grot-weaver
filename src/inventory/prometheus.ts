import { ProxyGet } from '../datasources/proxy';
import { Limiter } from '../datasources/limiter';
import { QueryWindow, prometheusLookback, prometheusWindowParams } from '../window/window';
import { CollectionError, MetricDatasource, MetricOwner, OwnerLabelKeys } from './types';
import { errorMessage, guardStep } from './guard';
import { Batch, MAX_WINDOW_SPLITS, SeriesOf, isQueryLimitError, planBatches, sliceWindow } from './queryBudget';

const TARGET_INFO = 'target_info';
const OWNER_LABELS = ['job', 'service_name', 'service_namespace', 'otel_scope_name', 'otel_scope_version'];
export const MAX_LABEL_KEY_CALLS = 1000;
const CARDINALITY_NAMES_LIMIT = '500';
const PRESENCE_LABEL_PREFIX = 'semconv_has_';
const REGEX_META = /[.*+?^${}()|[\]\\]/g;

interface PrometheusResponse<T> {
  status: string;
  data: T;
}

interface CardinalityResponse {
  labels?: Array<{ cardinality?: Array<{ label_value: string; series_count: number }> }>;
}

interface VectorSample {
  metric: Record<string, string>;
  value: [number, string];
}

interface Context {
  uid: string;
  get: ProxyGet;
  limit: Limiter;
  window: QueryWindow;
  presenceAttributes: string[];
  errors: CollectionError[];
}

export interface PrometheusCollection {
  datasource: MetricDatasource;
  errors: CollectionError[];
}

export type NamesNeedingLabels = (names: string[]) => Promise<string[]>;

export interface LabelProgress {
  done: number;
  total: number;
}

const SELECTOR_LABELS = ['job', 'service_name', 'instance'];
const COLLECTOR_LABELS = [
  'job',
  'instance',
  'collector_id',
  'pod',
  'workload',
  'receiver',
  'component_path',
  'component_id',
];
const COLLECTOR_METRICS = 'otelcol_receiver_accepted_.+|alloy_build_info';

export function collectorsQuery(window: QueryWindow): string {
  return `count by (${COLLECTOR_LABELS.join(', ')}) (last_over_time({__name__=~"${COLLECTOR_METRICS}"}[${prometheusLookback(window)}]))`;
}

export function nameMatcher(names: string[]): string {
  const alternatives = names.map((name) => promqlString(name.replace(REGEX_META, '\\$&')));
  return `{__name__=~"${alternatives.join('|')}"}`;
}

function promqlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function promLabelName(attribute: string): string {
  return attribute.replace(/[^a-zA-Z0-9_]/g, '_');
}

export function ownersQuery(names: string[], window: QueryWindow, presenceAttributes: string[] = []): string {
  const labels = [...new Set(presenceAttributes.map(promLabelName))];
  const flagged = labels.reduce(
    (inner, label) => `label_replace(${inner}, "${PRESENCE_LABEL_PREFIX}${label}", "1", "${label}", ".+")`,
    `last_over_time(${nameMatcher(names)}[${prometheusLookback(window)}])`
  );
  const grouping = ['__name__', ...OWNER_LABELS, ...labels.map((label) => PRESENCE_LABEL_PREFIX + label)];
  return `count by (${grouping.join(', ')}) (${flagged})`;
}

export function anonymousOwnersQuery(names: string[], window: QueryWindow): string {
  const selector = nameMatcher(names).replace(/\}$/, ', job="", service_name=""}');
  return `count by (__name__, instance) (last_over_time(${selector}[${prometheusLookback(window)}]))`;
}

export async function collectPrometheusInventory(
  uid: string,
  get: ProxyGet,
  limit: Limiter,
  window: QueryWindow,
  namesNeedingLabels: NamesNeedingLabels = async () => [],
  onLabelProgress: (progress: LabelProgress) => void = () => undefined,
  presenceAttributes: string[] = []
): Promise<PrometheusCollection> {
  const context: Context = { uid, get, limit, window, presenceAttributes, errors: [] };
  const [names, targetInfo, collectors] = await Promise.all([
    guarded(context, 'metric names', () => metricNames(context)),
    guarded(context, 'target_info series', () => targetInfoSeries(context)),
    guarded(context, 'collector self-metrics', async () =>
      (await instantQuery(context, collectorsQuery(window))).map((sample) => sample.metric)
    ),
  ]);
  const owners = await collectOwners(context, names ?? []);
  const needing = new Set((await guarded(context, 'metric matches', () => namesNeedingLabels(names ?? []))) ?? []);
  const labelKeys = await collectLabelKeys(
    context,
    owners.filter((owner) => needing.has(owner.metric)),
    onLabelProgress
  );
  return {
    datasource: {
      uid,
      names: names ?? [],
      target_info: targetInfo ?? [],
      owners,
      label_keys: labelKeys,
      collectors: collectors ?? [],
      ...(presenceAttributes.length > 0 && { resource_label_checks: presenceAttributes }),
    },
    errors: context.errors,
  };
}

export function ownerSelector(owner: MetricOwner): Record<string, string> | undefined {
  const key = SELECTOR_LABELS.find((label) => owner.labels[label]);
  return key ? { [key]: owner.labels[key] } : undefined;
}

export function labelsMatcher(metric: string, selector: Record<string, string>): string {
  const matchers = [
    `__name__="${promqlString(metric)}"`,
    ...Object.entries(selector).map(([key, value]) => `${key}="${promqlString(value)}"`),
  ];
  return `{${matchers.join(', ')}}`;
}

async function collectLabelKeys(
  context: Context,
  owners: MetricOwner[],
  onProgress: (progress: LabelProgress) => void
): Promise<OwnerLabelKeys[]> {
  const pairs = uniquePairs(owners);
  const checked = pairs.slice(0, MAX_LABEL_KEY_CALLS);
  if (checked.length < pairs.length) {
    context.errors.push({
      datasource: context.uid,
      step: 'label keys',
      message: `checked label keys for the ${checked.length} busiest of ${pairs.length} metric and owner pairs; the rest were skipped to bound the scan`,
    });
  }
  let done = 0;
  onProgress({ done, total: checked.length });
  const sets = await Promise.all(
    checked.map(async ({ metric, selector }) => {
      const keys = await guarded(context, `label keys for ${metric}`, () =>
        labelNames(context, labelsMatcher(metric, selector))
      );
      done++;
      onProgress({ done, total: checked.length });
      return keys ? { metric, selector, keys } : undefined;
    })
  );
  return sets.filter((set): set is OwnerLabelKeys => set !== undefined);
}

interface LabelPair {
  metric: string;
  selector: Record<string, string>;
  series: number;
}

function uniquePairs(owners: MetricOwner[]): LabelPair[] {
  const seen = new Map<string, LabelPair>();
  for (const owner of owners) {
    const selector = ownerSelector(owner);
    if (!selector) {
      continue;
    }
    const key = `${owner.metric}|${JSON.stringify(selector)}`;
    const pair = seen.get(key) ?? { metric: owner.metric, selector, series: 0 };
    pair.series += owner.series;
    seen.set(key, pair);
  }
  return [...seen.values()].sort((a, b) => b.series - a.series);
}

async function labelNames(context: Context, matcher: string): Promise<string[]> {
  const params = { ...prometheusWindowParams(context.window), 'match[]': matcher };
  const response = await context.limit(() =>
    context.get<PrometheusResponse<string[]>>(context.uid, '/api/v1/labels', params)
  );
  return [...response.data].sort();
}

async function metricNames(context: Context): Promise<string[]> {
  const response = await context.limit(() =>
    context.get<PrometheusResponse<string[]>>(
      context.uid,
      '/api/v1/label/__name__/values',
      prometheusWindowParams(context.window)
    )
  );
  return [...response.data].sort();
}

async function targetInfoSeries(context: Context): Promise<Array<Record<string, string>>> {
  const params = { ...prometheusWindowParams(context.window), 'match[]': TARGET_INFO };
  const response = await context.limit(() =>
    context.get<PrometheusResponse<Array<Record<string, string>>>>(context.uid, '/api/v1/series', params)
  );
  return response.data.map(({ __name__, ...labels }) => labels);
}

export function isRecordingRule(name: string): boolean {
  return name.includes(':');
}

async function collectOwners(context: Context, names: string[]): Promise<MetricOwner[]> {
  const seriesOf = await activeSeriesByName(context);
  const batches = planBatches(
    names.filter((name) => !isRecordingRule(name)),
    seriesOf,
    context.window
  );
  const owned = await Promise.all(
    batches.map((batch, index) =>
      guarded(context, `owners batch ${index + 1}/${batches.length}`, () => ownersAcross(context, batch))
    )
  );
  return owned.flatMap((owners) => owners ?? []);
}

async function activeSeriesByName(context: Context): Promise<SeriesOf> {
  try {
    const response = await context.limit(() =>
      context.get<CardinalityResponse>(context.uid, '/api/v1/cardinality/label_values', {
        'label_names[]': '__name__',
        limit: CARDINALITY_NAMES_LIMIT,
      })
    );
    const counts = new Map(
      (response.labels?.[0]?.cardinality ?? []).map((entry) => [entry.label_value, entry.series_count])
    );
    const truncated = counts.size >= Number(CARDINALITY_NAMES_LIMIT);
    const floor = truncated ? Math.min(...counts.values()) : 0;
    return (name) => counts.get(name) ?? floor;
  } catch {
    return () => 0;
  }
}

async function ownersAcross(context: Context, batch: Batch): Promise<MetricOwner[]> {
  const slices = await Promise.all(batch.windows.map((window) => boundedOwners(context, batch.names, window, 0)));
  return mergeOwnerSlices(slices.flat());
}

async function boundedOwners(
  context: Context,
  names: string[],
  window: QueryWindow,
  windowSplits: number
): Promise<MetricOwner[]> {
  try {
    return await ownersForBatch(context, names, window);
  } catch (error) {
    const canSplit = names.length > 1 || windowSplits < MAX_WINDOW_SPLITS;
    if (!canSplit || !isQueryLimitError(errorMessage(error))) {
      throw error;
    }
    const middle = Math.ceil(names.length / 2);
    const parts =
      names.length > 1
        ? [names.slice(0, middle), names.slice(middle)].map((half) =>
            boundedOwners(context, half, window, windowSplits)
          )
        : sliceWindow(window, 2).map((slice) => boundedOwners(context, names, slice, windowSplits + 1));
    return mergeOwnerSlices((await Promise.all(parts)).flat());
  }
}

function mergeOwnerSlices(owners: MetricOwner[]): MetricOwner[] {
  const merged = new Map<string, MetricOwner>();
  for (const owner of owners) {
    const key = JSON.stringify([owner.metric, Object.entries(owner.labels).sort()]);
    const existing = merged.get(key);
    merged.set(key, existing && existing.series >= owner.series ? existing : owner);
  }
  return [...merged.values()];
}

async function ownersForBatch(context: Context, batch: string[], window: QueryWindow): Promise<MetricOwner[]> {
  const owners = (await instantQuery(context, ownersQuery(batch, window, context.presenceAttributes), window)).map(
    toOwner
  );
  const anonymous = owners
    .filter((owner) => !owner.labels.job && !owner.labels.service_name)
    .map((owner) => owner.metric);
  if (anonymous.length === 0) {
    return owners;
  }
  const byInstance = (await instantQuery(context, anonymousOwnersQuery(anonymous, window), window)).map(toOwner);
  return [...owners.filter((owner) => owner.labels.job || owner.labels.service_name), ...byInstance];
}

async function instantQuery(
  context: Context,
  query: string,
  window: QueryWindow = context.window
): Promise<VectorSample[]> {
  const params = { query, time: String(window.endSeconds) };
  const response = await context.limit(() =>
    context.get<PrometheusResponse<{ result: VectorSample[] }>>(context.uid, '/api/v1/query', params)
  );
  return response.data.result;
}

function toOwner(sample: VectorSample): MetricOwner {
  const { __name__, ...labels } = sample.metric;
  return { metric: __name__, labels, series: Number(sample.value[1]) };
}

function guarded<T>(context: Context, step: string, task: () => Promise<T>): Promise<T | undefined> {
  return guardStep(context.errors, context.uid, step, task);
}
