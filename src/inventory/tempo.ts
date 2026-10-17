import { ProxyGet } from '../datasources/proxy';
import { Limiter } from '../datasources/limiter';
import { QueryWindow, tempoWindowParams } from '../window/window';
import { SpanGroupRule } from '../api/catalogue';
import { CollectionError, KeyObservation, SDK, SpanGroupSample, TraceDatasource, TraceService } from './types';
import { applicableRules, sampleSpanGroup } from './spanGroups';
import { ServiceRef, serviceFilterExpression } from './traceql';
import { queryMetricsRange } from './traceqlMetrics';
import { KeysMethod, isTagFilterIgnored, sampleServiceKeys } from './traceKeys';
import { guardStep } from './guard';
import { Volumes, addVolume, volumeOf } from './volumes';

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

interface DiscoveredService {
  ref: ServiceRef;
  namespace: string;
}

export function serviceFilter(service: ServiceRef): string {
  return `{ ${serviceFilterExpression(service)} }`;
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
  const [serviceNames, filterIgnored, metricVolumes] = await Promise.all([
    guarded(context, 'service names', () => tagValues(context, SERVICE_NAME_TAG)),
    isTagFilterIgnored(context).catch(() => false),
    spanVolumes(context),
  ]);
  const keysMethod: KeysMethod = filterIgnored ? 'sample' : 'tags';
  const discovered = (
    await Promise.all(
      (serviceNames ?? []).map(async (name) =>
        servicesByNamespace(
          name,
          metricVolumes?.get(name)
            ? [...metricVolumes.get(name)!.keys()]
            : await namespacesFromTags(context, name, filterIgnored)
        )
      )
    )
  ).flat();
  const services = await Promise.all(discovered.map((service) => collectService(context, service, keysMethod)));
  const volumes = metricVolumes ?? (await sampledVolumes(context, discovered));
  services.forEach((service, index) => {
    service.span_count = volumeOf(volumes, discovered[index].ref) ?? 0;
  });
  const collection: TempoCollection = { datasource: { uid, services }, errors: context.errors };
  if (services.length > 0) {
    collection.volumeMethod = metricVolumes ? 'metrics' : 'sample';
    collection.keysMethod = keysMethod;
  }
  return collection;
}

function servicesByNamespace(name: string, namespaces: string[]): DiscoveredService[] {
  const distinct = [...new Set(namespaces)];
  if (distinct.length > 1) {
    return distinct.map((namespace) => ({ ref: { name, namespace }, namespace }));
  }
  return [{ ref: { name }, namespace: distinct[0] ?? '' }];
}

async function namespacesFromTags(context: CollectorContext, name: string, filterIgnored: boolean): Promise<string[]> {
  const step = `namespace for service "${name}"`;
  const values = await guarded(context, step, () => tagValues(context, SERVICE_NAMESPACE_TAG, serviceFilter({ name })));
  const namespaces = [...new Set((values ?? []).filter(Boolean))];
  if (filterIgnored) {
    return namespaces.slice(0, 1);
  }
  if (namespaces.length === 0) {
    return [];
  }
  const withoutNamespace = await guarded(context, step, () => hasSpans(context, { name, namespace: '' }));
  return withoutNamespace ? [...namespaces, ''] : namespaces;
}

async function hasSpans(context: CollectorContext, service: ServiceRef): Promise<boolean> {
  const params = { ...tempoWindowParams(context.window), q: serviceFilter(service), limit: '1' };
  const response = await context.limit(() => context.get<SearchResponse>(context.uid, '/api/search', params));
  return (response.traces ?? []).length > 0;
}

async function spanVolumes(context: CollectorContext): Promise<Volumes | undefined> {
  let series;
  try {
    series = await queryMetricsRange(
      context,
      `{ } | count_over_time() by (${SERVICE_NAME_TAG}, ${SERVICE_NAMESPACE_TAG})`
    );
  } catch {
    return undefined;
  }
  const volumes: Volumes = new Map();
  for (const entry of series) {
    const label = (key: string) => entry.labels?.find((candidate) => candidate.key === key)?.value?.stringValue ?? '';
    const spans = (entry.samples ?? []).reduce((total, sample) => total + (sample.value ?? 0), 0);
    addVolume(volumes, label(SERVICE_NAME_TAG), label(SERVICE_NAMESPACE_TAG), spans);
  }
  return volumes;
}

async function sampledVolumes(context: CollectorContext, services: DiscoveredService[]): Promise<Volumes> {
  const volumes: Volumes = new Map();
  await Promise.all(
    services.map(async ({ ref }) => {
      const params = {
        ...tempoWindowParams(context.window),
        q: serviceFilter(ref),
        limit: String(context.sampleLimit ?? DEFAULT_VOLUME_SAMPLE_LIMIT),
      };
      const response = await guarded(context, `span volume sample for ${describe(ref)}`, () =>
        context.limit(() => context.get<SearchResponse>(context.uid, '/api/search', params))
      );
      const spans = (response?.traces ?? [])
        .flatMap((trace) => trace.spanSets ?? [])
        .reduce((total, set) => total + (set.matched ?? 0), 0);
      addVolume(volumes, ref.name, ref.namespace ?? '', spans);
    })
  );
  return volumes;
}

function describe(service: ServiceRef): string {
  return service.namespace ? `service "${service.namespace}/${service.name}"` : `service "${service.name}"`;
}

async function collectService(
  context: CollectorContext,
  { ref, namespace }: DiscoveredService,
  keysMethod: KeysMethod
): Promise<TraceService> {
  const filter = serviceFilter(ref);
  const step = (what: string) => `${what} for ${describe(ref)}`;
  const [keys, sdk] = await Promise.all([
    collectKeys(context, ref, filter, keysMethod, step),
    collectSDK(context, filter, step),
  ]);
  const { resourceKeys, spanKeys } = keys;
  const spanGroups = await collectSpanGroups(context, ref, spanKeys ?? [], step);
  return {
    service_name: ref.name,
    service_namespace: namespace,
    span_count: 0,
    resource_keys: observations(resourceKeys),
    span_keys: observations(spanKeys),
    span_groups: spanGroups,
    sdk,
  };
}

async function collectKeys(
  context: CollectorContext,
  service: ServiceRef,
  filter: string,
  keysMethod: KeysMethod,
  step: (what: string) => string
): Promise<{ resourceKeys?: string[]; spanKeys?: string[] }> {
  if (keysMethod === 'sample') {
    const sampled = await guarded(context, step('sampled keys'), () => sampleServiceKeys(context, service, filter));
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
  service: ServiceRef,
  spanKeys: string[],
  step: (what: string) => string
): Promise<SpanGroupSample[]> {
  const samples = await Promise.all(
    applicableRules(context.spanGroupRules, spanKeys).map((rule) =>
      guarded(context, step(`span group ${rule.id}`), () => sampleSpanGroup(context, service, rule))
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
