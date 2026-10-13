import { ProxyGet } from '../datasources/proxy';
import { Limiter } from '../datasources/limiter';
import { QueryWindow, prometheusLookback, prometheusWindowParams } from '../window/window';
import { CollectionError, MetricDatasource, MetricOwner } from './types';

const TARGET_INFO = 'target_info';
const OWNER_LABELS = ['job', 'service_name', 'service_namespace', 'otel_scope_name', 'otel_scope_version'];
const NAMES_PER_BATCH = 40;
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
  errors: CollectionError[];
}

export interface PrometheusCollection {
  datasource: MetricDatasource;
  errors: CollectionError[];
}

export function nameMatcher(names: string[]): string {
  const alternatives = names.map((name) => promqlString(name.replace(REGEX_META, '\\$&')));
  return `{__name__=~"${alternatives.join('|')}"}`;
}

function promqlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function ownersQuery(names: string[], window: QueryWindow): string {
  return `count by (__name__, ${OWNER_LABELS.join(', ')}) (last_over_time(${nameMatcher(names)}[${prometheusLookback(window)}]))`;
}

export function anonymousOwnersQuery(names: string[], window: QueryWindow): string {
  const selector = nameMatcher(names).replace(/\}$/, ', job="", service_name=""}');
  return `count by (__name__, instance) (last_over_time(${selector}[${prometheusLookback(window)}]))`;
}

export async function collectPrometheusInventory(uid: string, get: ProxyGet, limit: Limiter, window: QueryWindow): Promise<PrometheusCollection> {
  const context: Context = { uid, get, limit, window, errors: [] };
  const [names, targetInfo] = await Promise.all([
    guarded(context, 'metric names', () => metricNames(context)),
    guarded(context, 'target_info series', () => targetInfoSeries(context)),
  ]);
  const owners = await collectOwners(context, names ?? []);
  return { datasource: { uid, names: names ?? [], target_info: targetInfo ?? [], owners }, errors: context.errors };
}

async function metricNames(context: Context): Promise<string[]> {
  const response = await context.limit(() =>
    context.get<PrometheusResponse<string[]>>(context.uid, '/api/v1/label/__name__/values', prometheusWindowParams(context.window))
  );
  return [...response.data].sort();
}

async function targetInfoSeries(context: Context): Promise<Array<Record<string, string>>> {
  const params = { ...prometheusWindowParams(context.window), 'match[]': TARGET_INFO };
  const response = await context.limit(() => context.get<PrometheusResponse<Array<Record<string, string>>>>(context.uid, '/api/v1/series', params));
  return response.data.map(({ __name__, ...labels }) => labels);
}

async function collectOwners(context: Context, names: string[]): Promise<MetricOwner[]> {
  const batches = chunk(names, NAMES_PER_BATCH);
  const owned = await Promise.all(
    batches.map((batch, index) => guarded(context, `owners batch ${index + 1}/${batches.length}`, () => ownersForBatch(context, batch)))
  );
  return owned.flatMap((owners) => owners ?? []);
}

async function ownersForBatch(context: Context, batch: string[]): Promise<MetricOwner[]> {
  const owners = (await instantQuery(context, ownersQuery(batch, context.window))).map(toOwner);
  const anonymous = owners.filter((owner) => !owner.labels.job && !owner.labels.service_name).map((owner) => owner.metric);
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

async function guarded<T>(context: Context, step: string, task: () => Promise<T>): Promise<T | undefined> {
  try {
    return await task();
  } catch (error) {
    const candidate = (error ?? {}) as { data?: { error?: string; message?: string }; message?: string };
    context.errors.push({ datasource: context.uid, step, message: candidate.data?.error ?? candidate.data?.message ?? candidate.message ?? String(error) });
    return undefined;
  }
}
