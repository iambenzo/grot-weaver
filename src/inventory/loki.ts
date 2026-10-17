import { ProxyGet } from '../datasources/proxy';
import { Limiter } from '../datasources/limiter';
import { QueryWindow, lokiWindowParams } from '../window/window';
import { CollectionError, LogDatasource, LogKeysMethod, LogService, SDK, ServiceRef } from './types';
import { guardStep } from './guard';
import { MAX_LOG_SERVICES, limitError } from './limits';
import { Volumes, addVolume, volumeOf } from './volumes';

const SERVICE_NAME = 'service_name';
const SERVICE_NAMESPACE = 'service_namespace';
const VALUES_SAMPLE_LIMIT = '5';
const DEFAULT_KEYS_SAMPLE_LIMIT = 20;
const VOLUME_SELECTOR = `{${SERVICE_NAME}=~".+", ${SERVICE_NAMESPACE}=~".*"}`;
export const VOLUME_SERIES_LIMIT = 5000;
const CATEGORIZE_LABELS = { 'X-Loki-Response-Encoding-Flags': 'categorize-labels' };

export const OTLP_MARKERS = [
  'scope_name',
  'severity_number',
  'observed_timestamp',
  'flags',
  'telemetry_sdk_name',
  'telemetry_sdk_language',
  'telemetry_sdk_version',
];

interface LokiResponse<T> {
  status?: string;
  data: T;
}

interface DetectedFieldsResponse {
  fields?: Array<{ label: string; parsers?: string[] | null }>;
}

interface SampleStream {
  stream: Record<string, string>;
  values: Array<[string, string, { structuredMetadata?: Record<string, string>; parsed?: Record<string, string> }?]>;
}

interface IndexStats {
  bytes?: number;
}

interface Context {
  uid: string;
  get: ProxyGet;
  limit: Limiter;
  window: QueryWindow;
  errors: CollectionError[];
  sampleLimit?: number;
  volumes?: Volumes;
}

export interface LokiCollection {
  datasource: LogDatasource;
  errors: CollectionError[];
}

export function streamSelector(service: ServiceRef): string {
  const matchers = [`${SERVICE_NAME}="${escapeLabelValue(service.name)}"`];
  if (service.namespace !== undefined) {
    matchers.push(`${SERVICE_NAMESPACE}="${escapeLabelValue(service.namespace)}"`);
  }
  return `{${matchers.join(', ')}}`;
}

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export async function collectLokiInventory(
  uid: string,
  get: ProxyGet,
  limit: Limiter,
  window: QueryWindow,
  sampleLimit?: number
): Promise<LokiCollection> {
  const context: Context = { uid, get, limit, window, errors: [], sampleLimit };
  const [labels, serviceNames, volumes] = await Promise.all([
    guarded(context, 'labels', () => lokiGet<string[]>(context, '/loki/api/v1/labels', lokiWindowParams(window))),
    guarded(context, 'service names', () =>
      lokiGet<string[]>(context, `/loki/api/v1/label/${SERVICE_NAME}/values`, lokiWindowParams(window))
    ),
    indexVolumes(context).catch(() => undefined),
  ]);
  context.volumes = volumes;
  const notScanned = (count: number): LokiCollection => ({
    datasource: { uid, labels: [], services: [] },
    errors: [
      ...context.errors,
      limitError(uid, 'service names', count, MAX_LOG_SERVICES, 'this datasource was not scanned'),
    ],
  });
  if ((serviceNames ?? []).length > MAX_LOG_SERVICES) {
    return notScanned(serviceNames!.length);
  }
  const services = (await Promise.all((serviceNames ?? []).map((name) => collectServices(context, name)))).flat();
  if (services.length > MAX_LOG_SERVICES) {
    return notScanned(services.length);
  }
  return { datasource: { uid, labels: [...(labels ?? [])].sort(), services }, errors: context.errors };
}

async function collectServices(context: Context, name: string): Promise<LogService[]> {
  const series =
    (await guarded(context, `streams for service "${name}"`, () =>
      lokiGet<Array<Record<string, string>>>(context, '/loki/api/v1/series', {
        ...lokiWindowParams(context.window),
        'match[]': streamSelector({ name }),
      })
    )) ?? [];
  const namespaceOf = (labels: Record<string, string>) => labels[SERVICE_NAMESPACE] ?? '';
  const namespaces = [...new Set(series.map(namespaceOf))];
  if (namespaces.length <= 1) {
    return [await collectService(context, { name }, series, namespaces[0] ?? '')];
  }
  return Promise.all(
    namespaces.map((namespace) =>
      collectService(
        context,
        { name, namespace },
        series.filter((labels) => namespaceOf(labels) === namespace),
        namespace
      )
    )
  );
}

async function collectService(
  context: Context,
  service: ServiceRef,
  series: Array<Record<string, string>>,
  namespace: string
): Promise<LogService> {
  const where =
    service.namespace === undefined ? service.name : `${service.namespace || '(no namespace)'}/${service.name}`;
  const step = (what: string) => `${what} for service "${where}"`;
  const selector = streamSelector(service);
  const [detected, sample, volume] = await Promise.all([
    detectedFieldKeys(context, selector),
    guarded(context, step('sample'), () => sampleStreams(context, selector, VALUES_SAMPLE_LIMIT)),
    serviceVolume(context, service, selector, step),
  ]);

  let method: LogKeysMethod = 'detected_fields';
  let keySample = sample ?? [];
  if (!detected) {
    method = 'sample';
    keySample =
      (await guarded(context, step('key sample'), () =>
        sampleStreams(context, selector, String(context.sampleLimit ?? DEFAULT_KEYS_SAMPLE_LIMIT))
      )) ?? keySample;
  }
  const metadataKeys = detected ?? keysOf(keySample);
  const streamLabels = [...new Set(series.flatMap((labels) => Object.keys(labels)))].sort();

  return {
    service_name: service.name,
    service_namespace: namespace,
    stream_labels: streamLabels,
    metadata_keys: metadataKeys,
    keys_method: method,
    sampled_lines: lineCount(keySample),
    otlp_markers: OTLP_MARKERS.filter((marker) => metadataKeys.includes(marker)),
    scope_names: valuesOf(sample ?? [], 'scope_name'),
    sdk: sdkOf(sample ?? []),
    volume: volume ?? 0,
  };
}

async function detectedFieldKeys(context: Context, selector: string): Promise<string[] | undefined> {
  try {
    const response = await context.limit(() =>
      context.get<DetectedFieldsResponse>(context.uid, '/loki/api/v1/detected_fields', {
        ...lokiWindowParams(context.window),
        query: selector,
      })
    );
    return (response.fields ?? [])
      .filter((field) => !field.parsers || field.parsers.length === 0)
      .map((field) => field.label)
      .sort();
  } catch {
    return undefined;
  }
}

async function sampleStreams(context: Context, selector: string, lineLimit: string): Promise<SampleStream[]> {
  const params = { ...lokiWindowParams(context.window), query: selector, limit: lineLimit, direction: 'backward' };
  const response = await context.limit(() =>
    context.get<LokiResponse<{ result: SampleStream[] }>>(
      context.uid,
      '/loki/api/v1/query_range',
      params,
      CATEGORIZE_LABELS
    )
  );
  return response.data.result;
}

async function indexVolumes(context: Context): Promise<Volumes> {
  const result = await lokiGet<{ result: Array<{ metric: Record<string, string>; value: [number, string] }> }>(
    context,
    '/loki/api/v1/index/volume',
    { ...lokiWindowParams(context.window), query: VOLUME_SELECTOR, limit: String(VOLUME_SERIES_LIMIT) }
  );
  const volumes: Volumes = new Map();
  for (const { metric, value } of result.result) {
    addVolume(volumes, metric[SERVICE_NAME] ?? '', metric[SERVICE_NAMESPACE] ?? '', Number(value[1]));
  }
  return volumes;
}

async function serviceVolume(
  context: Context,
  service: ServiceRef,
  selector: string,
  step: (what: string) => string
): Promise<number | undefined> {
  const indexed = context.volumes && volumeOf(context.volumes, service);
  if (indexed !== undefined) {
    return indexed;
  }
  const stats = await guarded(context, step('volume'), () =>
    context.limit(() =>
      context.get<IndexStats>(context.uid, '/loki/api/v1/index/stats', {
        ...lokiWindowParams(context.window),
        query: selector,
      })
    )
  );
  return stats?.bytes;
}

async function lokiGet<T>(context: Context, path: string, params: Record<string, string>): Promise<T> {
  const response = await context.limit(() => context.get<LokiResponse<T>>(context.uid, path, params));
  return response.data;
}

function metadataOf(streams: SampleStream[]): Array<Record<string, string>> {
  return streams.flatMap((stream) => stream.values.map((entry) => entry[2]?.structuredMetadata ?? {}));
}

function keysOf(streams: SampleStream[]): string[] {
  return [...new Set(metadataOf(streams).flatMap((metadata) => Object.keys(metadata)))].sort();
}

function valuesOf(streams: SampleStream[], key: string): string[] {
  return [
    ...new Set(
      metadataOf(streams)
        .map((metadata) => metadata[key])
        .filter(Boolean)
    ),
  ].sort();
}

function sdkOf(streams: SampleStream[]): SDK {
  const first = (key: string) => valuesOf(streams, key)[0];
  const sdk: SDK = {};
  const name = first('telemetry_sdk_name');
  const language = first('telemetry_sdk_language');
  const version = first('telemetry_sdk_version');
  if (name) {
    sdk.name = name;
  }
  if (language) {
    sdk.language = language;
  }
  if (version) {
    sdk.version = version;
  }
  return sdk;
}

function lineCount(streams: SampleStream[]): number {
  return streams.reduce((total, stream) => total + stream.values.length, 0);
}

function guarded<T>(context: Context, step: string, task: () => Promise<T>): Promise<T | undefined> {
  return guardStep(context.errors, context.uid, step, task);
}
