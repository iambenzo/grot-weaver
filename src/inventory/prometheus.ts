import { ProxyGet } from '../datasources/proxy';
import { Limiter } from '../datasources/limiter';
import { QueryWindow, prometheusLookback, prometheusWindowParams } from '../window/window';
import { CollectionError, MetricDatasource, MetricOwner, OwnerLabelKeys } from './types';
import { guardStep } from './guard';

const TARGET_INFO = 'target_info';
const OWNER_LABELS = ['job', 'service_name', 'service_namespace', 'otel_scope_name', 'otel_scope_version'];
const NAMES_PER_BATCH = 40;
const PRESENCE_LABEL_PREFIX = 'semconv_has_';
const REGEX_META = /[.*+?^${}()|[\]\\]/g;

interface PrometheusResponse<T> {
  status: string;
  data: T;
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
  let done = 0;
  onProgress({ done, total: pairs.length });
  const sets = await Promise.all(
    pairs.map(async ({ metric, selector }) => {
      const keys = await guarded(context, `label keys for ${metric}`, () =>
        labelNames(context, labelsMatcher(metric, selector))
      );
      done++;
      onProgress({ done, total: pairs.length });
      return keys ? { metric, selector, keys } : undefined;
    })
  );
  return sets.filter((set): set is OwnerLabelKeys => set !== undefined);
}

function uniquePairs(owners: MetricOwner[]): Array<{ metric: string; selector: Record<string, string> }> {
  const seen = new Map<string, { metric: string; selector: Record<string, string> }>();
  for (const owner of owners) {
    const selector = ownerSelector(owner);
    if (selector) {
      seen.set(`${owner.metric}|${JSON.stringify(selector)}`, { metric: owner.metric, selector });
    }
  }
  return [...seen.values()];
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
  const batches = chunk(
    names.filter((name) => !isRecordingRule(name)),
    NAMES_PER_BATCH
  );
  const owned = await Promise.all(
    batches.map((batch, index) =>
      guarded(context, `owners batch ${index + 1}/${batches.length}`, () => ownersForBatch(context, batch))
    )
  );
  return owned.flatMap((owners) => owners ?? []);
}

async function ownersForBatch(context: Context, batch: string[]): Promise<MetricOwner[]> {
  const owners = (await instantQuery(context, ownersQuery(batch, context.window, context.presenceAttributes))).map(
    toOwner
  );
  const anonymous = owners
    .filter((owner) => !owner.labels.job && !owner.labels.service_name)
    .map((owner) => owner.metric);
  if (anonymous.length === 0) {
    return owners;
  }
  const byInstance = (await instantQuery(context, anonymousOwnersQuery(anonymous, context.window))).map(toOwner);
  return [...owners.filter((owner) => owner.labels.job || owner.labels.service_name), ...byInstance];
}

async function instantQuery(context: Context, query: string): Promise<VectorSample[]> {
  const params = { query, time: String(context.window.endSeconds) };
  const response = await context.limit(() =>
    context.get<PrometheusResponse<{ result: VectorSample[] }>>(context.uid, '/api/v1/query', params)
  );
  return response.data.result;
}

function toOwner(sample: VectorSample): MetricOwner {
  const { __name__, ...labels } = sample.metric;
  return { metric: __name__, labels, series: Number(sample.value[1]) };
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

function guarded<T>(context: Context, step: string, task: () => Promise<T>): Promise<T | undefined> {
  return guardStep(context.errors, context.uid, step, task);
}
