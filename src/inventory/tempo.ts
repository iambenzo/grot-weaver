import { ProxyGet } from '../datasources/proxy';
import { Limiter } from '../datasources/limiter';
import { QueryWindow, tempoWindowParams } from '../window/window';
import { SpanGroupRule } from '../api/catalogue';
import { CollectionError, KeyObservation, SDK, SpanGroupSample, TraceDatasource, TraceService } from './types';
import { applicableRules, sampleSpanGroup } from './spanGroups';
import { ServiceRef, serviceFilterExpression } from './traceql';
import { MetricsSeries, labelValue, queryMetricsRange, spanTotal } from './traceqlMetrics';
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

export type VolumeMethod = 'metrics' | 'mixed' | 'sample';

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

interface MeasuredSeries {
  name: string;
  namespace: string;
  sdk: SDK;
  spans: number;
}

interface Measured {
  volumes: Volumes;
  sdks: MeasuredSeries[];
  distros?: MeasuredSeries[];
}

interface DiscoveredService {
  ref: ServiceRef;
  namespace?: string;
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
  const [serviceNames, filterIgnored, measured] = await Promise.all([
    guarded(context, 'service names', () => tagValues(context, SERVICE_NAME_TAG)),
    isTagFilterIgnored(context).catch(() => false),
    measureServices(context),
  ]);
  const metricVolumes = measured?.volumes;
  const keysMethod: KeysMethod = filterIgnored ? 'sample' : 'tags';
  const discovered = (
    await Promise.all(
      (serviceNames ?? []).map(async (name) =>
        servicesByNamespace(name, await discoverNamespaces(context, name, metricVolumes?.get(name), filterIgnored))
      )
    )
  ).flat();
  const services = await Promise.all(
    discovered.map((service) => collectService(context, service, keysMethod, measured))
  );
  const unmeasured = metricVolumes
    ? discovered.filter(({ ref }) => volumeOf(metricVolumes, ref) === undefined)
    : discovered;
  const sampled = await sampledVolumes(context, unmeasured);
  const volumes = metricVolumes ? withSampled(metricVolumes, sampled) : sampled;
  services.forEach((service, index) => {
    service.span_count = volumeOf(volumes, discovered[index].ref) ?? 0;
  });
  const collection: TempoCollection = { datasource: { uid, services }, errors: context.errors };
  if (services.length > 0) {
    collection.volumeMethod = !metricVolumes ? 'sample' : unmeasured.length > 0 ? 'mixed' : 'metrics';
    collection.keysMethod = keysMethod;
  }
  return collection;
}

function servicesByNamespace(name: string, namespaces: string[] | undefined): DiscoveredService[] {
  if (namespaces === undefined) {
    return [{ ref: { name } }];
  }
  const distinct = [...new Set(namespaces)];
  if (distinct.length > 1) {
    return distinct.map((namespace) => ({ ref: { name, namespace }, namespace }));
  }
  return [{ ref: { name }, namespace: distinct[0] ?? '' }];
}

async function discoverNamespaces(
  context: CollectorContext,
  name: string,
  measured: Map<string, number> | undefined,
  filterIgnored: boolean
): Promise<string[] | undefined> {
  const fromMetrics = measured ? [...measured.keys()] : [];
  if (filterIgnored) {
    return measured ? fromMetrics : undefined;
  }
  const step = `namespace for service "${name}"`;
  const values = await guarded(context, step, () => tagValues(context, SERVICE_NAMESPACE_TAG, serviceFilter({ name })));
  const tagged = (values ?? []).filter(Boolean);
  if (measured) {
    return [...fromMetrics, ...tagged];
  }
  if (tagged.length === 0) {
    return [];
  }
  const withoutNamespace = await guarded(context, step, () => hasSpans(context, { name, namespace: '' }));
  return withoutNamespace ? [...tagged, ''] : tagged;
}

async function hasSpans(context: CollectorContext, service: ServiceRef): Promise<boolean> {
  const params = { ...tempoWindowParams(context.window), q: serviceFilter(service), limit: '1' };
  const response = await context.limit(() => context.get<SearchResponse>(context.uid, '/api/search', params));
  return (response.traces ?? []).length > 0;
}

async function measureServices(context: CollectorContext): Promise<Measured | undefined> {
  const sdkSeries = await spanSeries(context, [SDK_TAGS.name, SDK_TAGS.language, SDK_TAGS.version]);
  if (!sdkSeries) {
    return undefined;
  }
  const volumes: Volumes = new Map();
  for (const series of sdkSeries) {
    addVolume(volumes, series.name, series.namespace, series.spans);
  }
  return { volumes, sdks: sdkSeries, distros: await spanSeries(context, [SDK_TAGS.distro]) };
}

async function spanSeries(context: CollectorContext, sdkTags: string[]): Promise<MeasuredSeries[] | undefined> {
  let series: MetricsSeries[];
  try {
    series = await queryMetricsRange(
      context,
      `{ } | count_over_time() by (${[SERVICE_NAME_TAG, SERVICE_NAMESPACE_TAG, ...sdkTags].join(', ')})`
    );
  } catch {
    return undefined;
  }
  return series.map((entry) => ({
    name: labelValue(entry.labels, SERVICE_NAME_TAG),
    namespace: labelValue(entry.labels, SERVICE_NAMESPACE_TAG),
    sdk: sdkFromLabels(entry, sdkTags),
    spans: spanTotal(entry),
  }));
}

function sdkFromLabels(entry: MetricsSeries, sdkTags: string[]): SDK {
  const sdk: SDK = {};
  for (const field of Object.keys(SDK_TAGS) as Array<keyof SDK>) {
    const value = sdkTags.includes(SDK_TAGS[field]) ? labelValue(entry.labels, SDK_TAGS[field]) : '';
    if (value) {
      sdk[field] = value;
    }
  }
  return sdk;
}

function belongsTo(entry: MeasuredSeries, service: ServiceRef): boolean {
  return entry.name === service.name && (service.namespace === undefined || entry.namespace === service.namespace);
}

function heaviestFor(series: MeasuredSeries[], service: ServiceRef): MeasuredSeries | undefined {
  return series
    .filter((entry) => belongsTo(entry, service))
    .reduce<MeasuredSeries | undefined>(
      (heaviest, entry) => (heaviest && heaviest.spans >= entry.spans ? heaviest : entry),
      undefined
    );
}

function withSampled(measured: Volumes, sampled: Volumes): Volumes {
  for (const [name, byNamespace] of sampled) {
    byNamespace.forEach((spans, namespace) => addVolume(measured, name, namespace, spans));
  }
  return measured;
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

function soleNamespace(namespaces: string[] | undefined): string {
  return namespaces?.length === 1 ? namespaces[0] : '';
}

function describe(service: ServiceRef): string {
  return service.namespace ? `service "${service.namespace}/${service.name}"` : `service "${service.name}"`;
}

async function collectService(
  context: CollectorContext,
  { ref, namespace }: DiscoveredService,
  keysMethod: KeysMethod,
  measured: Measured | undefined
): Promise<TraceService> {
  const filter = serviceFilter(ref);
  const step = (what: string) => `${what} for ${describe(ref)}`;
  const [keys, sdk] = await Promise.all([
    collectKeys(context, ref, filter, keysMethod, step),
    collectSDK(context, ref, filter, step, measured),
  ]);
  const { resourceKeys, spanKeys, namespaces } = keys;
  const spanGroups = await collectSpanGroups(context, ref, spanKeys ?? [], step);
  return {
    service_name: ref.name,
    service_namespace: namespace ?? soleNamespace(namespaces),
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
): Promise<{ resourceKeys?: string[]; spanKeys?: string[]; namespaces?: string[] }> {
  if (keysMethod === 'sample') {
    const sampled = await guarded(context, step('sampled keys'), () => sampleServiceKeys(context, service, filter));
    return { resourceKeys: sampled?.resource, spanKeys: sampled?.span, namespaces: sampled?.namespaces };
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

async function collectSDK(
  context: CollectorContext,
  service: ServiceRef,
  filter: string,
  step: (what: string) => string,
  measured: Measured | undefined
): Promise<SDK> {
  const fromMetrics = measured && heaviestFor(measured.sdks, service);
  if (!fromMetrics) {
    return sdkFromTags(context, filter, step, Object.keys(SDK_TAGS) as Array<keyof SDK>);
  }
  if (!measured.distros) {
    return { ...fromMetrics.sdk, ...(await sdkFromTags(context, filter, step, ['distro'])) };
  }
  const distro = dominantDistro(measured.distros, service);
  return distro ? { ...fromMetrics.sdk, distro } : fromMetrics.sdk;
}

function dominantDistro(series: MeasuredSeries[], service: ServiceRef): string {
  const spansByDistro = new Map<string, number>();
  for (const entry of series.filter((candidate) => belongsTo(candidate, service))) {
    const distro = entry.sdk.distro ?? '';
    spansByDistro.set(distro, (spansByDistro.get(distro) ?? 0) + entry.spans);
  }
  return [...spansByDistro].reduce<[string, number]>((best, entry) => (entry[1] > best[1] ? entry : best), ['', -1])[0];
}

async function sdkFromTags(
  context: CollectorContext,
  filter: string,
  step: (what: string) => string,
  fields: Array<keyof SDK>
): Promise<SDK> {
  const entries = await Promise.all(
    fields.map(async (field) => {
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
