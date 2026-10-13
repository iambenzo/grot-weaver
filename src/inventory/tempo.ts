import { ProxyGet } from '../datasources/proxy';
import { Limiter } from '../datasources/limiter';
import { QueryWindow, tempoWindowParams } from '../window/window';
import { SpanGroupRule } from '../api/catalogue';
import { CollectionError, KeyObservation, SDK, SpanGroupSample, TraceDatasource, TraceService } from './types';
import { applicableRules, sampleSpanGroup } from './spanGroups';
import { serviceFilterExpression } from './traceql';
import { queryMetricsRange } from './traceqlMetrics';
import { KeysMethod, isTagFilterIgnored, sampleServiceKeys } from './traceKeys';
import { guardStep } from './guard';

const SERVICE_NAME_TAG = 'resource.service.name';
const SERVICE_NAMESPACE_TAG = 'resource.service.namespace';
const DEFAULT_VOLUME_SAMPLE_LIMIT = 20;

const SDK_TAGS: Record<keyof SDK, string> = {
  name: 'resource.telemetry.sdk.name',
  language: 'resource.telemetry.sdk.language',
  version: 'resource.telemetry.sdk.version',
  distro: 'resource.telemetry.distro.name',
};

interface TagValuesResponse {
  tagValues?: Array<{ type?: string; value?: string | null }>;
}

interface TagsResponse {
  scopes?: Array<{ name: string; tags?: string[] }>;
}

export type VolumeMethod = 'metrics' | 'sample';

export interface TempoCollection {
  datasource: TraceDatasource;
  errors: CollectionError[];
  volumeMethod?: VolumeMethod;
  keysMethod?: KeysMethod;
}

interface SearchResponse {
  traces?: Array<{ spanSets?: Array<{ matched?: number }> }>;
}

interface CollectorContext {
  uid: string;
  get: ProxyGet;
  limit: Limiter;
  window: QueryWindow;
  errors: CollectionError[];
  spanGroupRules: SpanGroupRule[];
  sampleLimit?: number;
}

export function serviceFilter(serviceName: string): string {
  return `{ ${serviceFilterExpression(serviceName)} }`;
}

export async function collectTempoInventory(
  uid: string,
  get: ProxyGet,
  limit: Limiter,
  window: QueryWindow,
  spanGroupRules: SpanGroupRule[] = [],
  sampleLimit?: number
): Promise<TempoCollection> {
  const context: CollectorContext = { uid, get, limit, window, errors: [], spanGroupRules, sampleLimit };
  const [serviceNames, filterIgnored] = await Promise.all([
    guarded(context, 'service names', () => tagValues(context, SERVICE_NAME_TAG)),
    isTagFilterIgnored(context).catch(() => false),
  ]);
  const keysMethod: KeysMethod = filterIgnored ? 'sample' : 'tags';
  const [services, metricVolumes] = await Promise.all([
    Promise.all((serviceNames ?? []).map((name) => collectService(context, name, keysMethod))),
    spanVolumes(context),
  ]);
  const volumes = metricVolumes ?? (await sampledVolumes(context, serviceNames ?? []));
  for (const service of services) {
    service.span_count = volumes.get(service.service_name) ?? 0;
  }
  const collection: TempoCollection = { datasource: { uid, services }, errors: context.errors };
  if (services.length > 0) {
    collection.volumeMethod = metricVolumes ? 'metrics' : 'sample';
    collection.keysMethod = keysMethod;
  }
  return collection;
}

async function spanVolumes(context: CollectorContext): Promise<Map<string, number> | undefined> {
  let series;
  try {
    series = await queryMetricsRange(context, `{ } | count_over_time() by (${SERVICE_NAME_TAG})`);
  } catch {
    return undefined;
  }
  const volumes = new Map<string, number>();
  for (const entry of series) {
    const name = entry.labels?.find((label) => label.key === SERVICE_NAME_TAG)?.value?.stringValue ?? '';
    const spans = (entry.samples ?? []).reduce((total, sample) => total + (sample.value ?? 0), 0);
    volumes.set(name, (volumes.get(name) ?? 0) + spans);
  }
  return volumes;
}

async function sampledVolumes(context: CollectorContext, serviceNames: string[]): Promise<Map<string, number>> {
  const counts = await Promise.all(
    serviceNames.map(async (name) => {
      const params = {
        ...tempoWindowParams(context.window),
        q: serviceFilter(name),
        limit: String(context.sampleLimit ?? DEFAULT_VOLUME_SAMPLE_LIMIT),
      };
      const response = await guarded(context, `span volume sample for service "${name}"`, () =>
        context.limit(() => context.get<SearchResponse>(context.uid, '/api/search', params))
      );
      const spans = (response?.traces ?? [])
        .flatMap((trace) => trace.spanSets ?? [])
        .reduce((total, set) => total + (set.matched ?? 0), 0);
      return [name, spans] as const;
    })
  );
  return new Map(counts);
}

async function collectService(
  context: CollectorContext,
  serviceName: string,
  keysMethod: KeysMethod
): Promise<TraceService> {
  const filter = serviceFilter(serviceName);
  const step = (what: string) => `${what} for service "${serviceName}"`;
  const [keys, namespaces, sdk] = await Promise.all([
    collectKeys(context, serviceName, filter, keysMethod, step),
    guarded(context, step('namespace'), () => tagValues(context, SERVICE_NAMESPACE_TAG, filter)),
    collectSDK(context, filter, step),
  ]);
  const { resourceKeys, spanKeys } = keys;
  const spanGroups = await collectSpanGroups(context, serviceName, spanKeys ?? [], step);
  return {
    service_name: serviceName,
    service_namespace: namespaces?.[0] ?? '',
    span_count: 0,
    resource_keys: observations(resourceKeys),
    span_keys: observations(spanKeys),
    span_groups: spanGroups,
    sdk,
  };
}

async function collectKeys(
  context: CollectorContext,
  serviceName: string,
  filter: string,
  keysMethod: KeysMethod,
  step: (what: string) => string
): Promise<{ resourceKeys?: string[]; spanKeys?: string[] }> {
  if (keysMethod === 'sample') {
    const sampled = await guarded(context, step('sampled keys'), () => sampleServiceKeys(context, serviceName, filter));
    return { resourceKeys: sampled?.resource, spanKeys: sampled?.span };
  }
  const [resourceKeys, spanKeys] = await Promise.all([
    guarded(context, step('resource keys'), () => scopedTags(context, 'resource', filter)),
    guarded(context, step('span keys'), () => scopedTags(context, 'span', filter)),
  ]);
  return { resourceKeys, spanKeys };
}

async function collectSpanGroups(
  context: CollectorContext,
  serviceName: string,
  spanKeys: string[],
  step: (what: string) => string
): Promise<SpanGroupSample[]> {
  const samples = await Promise.all(
    applicableRules(context.spanGroupRules, spanKeys).map((rule) =>
      guarded(context, step(`span group ${rule.id}`), () => sampleSpanGroup(context, serviceName, rule))
    )
  );
  return samples.filter((sample): sample is SpanGroupSample => sample !== undefined && sample.sampled > 0);
}

async function collectSDK(context: CollectorContext, filter: string, step: (what: string) => string): Promise<SDK> {
  const entries = await Promise.all(
    (Object.keys(SDK_TAGS) as Array<keyof SDK>).map(async (field) => {
      const values = await guarded(context, step(SDK_TAGS[field]), () => tagValues(context, SDK_TAGS[field], filter));
      return [field, values?.[0]] as const;
    })
  );
  const sdk: SDK = {};
  for (const [field, value] of entries) {
    if (value) {
      sdk[field] = value;
    }
  }
  return sdk;
}

async function tagValues(context: CollectorContext, tag: string, filter?: string): Promise<string[]> {
  const params: Record<string, string> = { ...tempoWindowParams(context.window) };
  if (filter) {
    params.q = filter;
  }
  const response = await context.limit(() =>
    context.get<TagValuesResponse>(context.uid, `/api/v2/search/tag/${encodeURIComponent(tag)}/values`, params)
  );
  return (response.tagValues ?? []).map((entry) => entry.value ?? '');
}

async function scopedTags(context: CollectorContext, scope: 'resource' | 'span', filter: string): Promise<string[]> {
  const params = { ...tempoWindowParams(context.window), scope, q: filter };
  const response = await context.limit(() => context.get<TagsResponse>(context.uid, '/api/v2/search/tags', params));
  return (response.scopes ?? []).filter((entry) => entry.name === scope).flatMap((entry) => entry.tags ?? []);
}

function guarded<T>(context: CollectorContext, step: string, task: () => Promise<T>): Promise<T | undefined> {
  return guardStep(context.errors, context.uid, step, task);
}

function observations(keys: string[] | undefined): KeyObservation[] {
  return [...new Set(keys ?? [])].sort().map((key) => ({ key, volume: 0 }));
}
