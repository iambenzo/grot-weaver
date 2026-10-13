import { ProxyGet } from '../datasources/proxy';
import { Limiter } from '../datasources/limiter';
import { QueryWindow, lokiWindowParams, prometheusLookback } from '../window/window';
import { CollectionError, LogDatasource, LogKeysMethod, LogService, SDK } from './types';

const SERVICE_NAME = 'service_name';
const SERVICE_NAMESPACE = 'service_namespace';
const VALUES_SAMPLE_LIMIT = '5';
const KEYS_SAMPLE_LIMIT = '20';
const CATEGORIZE_LABELS = { 'X-Loki-Response-Encoding-Flags': 'categorize-labels' };

export const OTLP_MARKERS = ['scope_name', 'severity_number', 'observed_timestamp', 'flags', 'telemetry_sdk_name', 'telemetry_sdk_language', 'telemetry_sdk_version'];

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

interface Context {
  uid: string;
  get: ProxyGet;
  limit: Limiter;
  window: QueryWindow;
  errors: CollectionError[];
}

export interface LokiCollection {
  datasource: LogDatasource;
  errors: CollectionError[];
}

export function streamSelector(serviceName: string): string {
  return `{${SERVICE_NAME}="${serviceName.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"}`;
}

export async function collectLokiInventory(uid: string, get: ProxyGet, limit: Limiter, window: QueryWindow): Promise<LokiCollection> {
  const context: Context = { uid, get, limit, window, errors: [] };
  const [labels, serviceNames] = await Promise.all([
    guarded(context, 'labels', () => lokiGet<string[]>(context, '/loki/api/v1/labels', lokiWindowParams(window))),
    guarded(context, 'service names', () => lokiGet<string[]>(context, `/loki/api/v1/label/${SERVICE_NAME}/values`, lokiWindowParams(window))),
  ]);
  const services = await Promise.all((serviceNames ?? []).map((name) => collectService(context, name)));
  return { datasource: { uid, labels: [...(labels ?? [])].sort(), services }, errors: context.errors };
}

async function collectService(context: Context, serviceName: string): Promise<LogService> {
  const step = (what: string) => `${what} for service "${serviceName}"`;
  const selector = streamSelector(serviceName);
  const [series, detected, sample, volume] = await Promise.all([
    guarded(context, step('streams'), () => lokiGet<Array<Record<string, string>>>(context, '/loki/api/v1/series', { ...lokiWindowParams(context.window), 'match[]': selector })),
    detectedFieldKeys(context, selector),
    guarded(context, step('sample'), () => sampleStreams(context, selector, VALUES_SAMPLE_LIMIT)),
    guarded(context, step('volume'), () => logVolume(context, selector)),
  ]);

  let method: LogKeysMethod = 'detected_fields';
  let keySample = sample ?? [];
  if (!detected) {
    method = 'sample';
    keySample = (await guarded(context, step('key sample'), () => sampleStreams(context, selector, KEYS_SAMPLE_LIMIT))) ?? keySample;
  }
  const metadataKeys = detected ?? keysOf(keySample);
  const streamLabels = [...new Set((series ?? []).flatMap((labels) => Object.keys(labels)))].sort();
  const namespaces = [...new Set((series ?? []).map((labels) => labels[SERVICE_NAMESPACE]).filter(Boolean))];

  return {
    service_name: serviceName,
    service_namespace: namespaces[0] ?? '',
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
      context.get<DetectedFieldsResponse>(context.uid, '/loki/api/v1/detected_fields', { ...lokiWindowParams(context.window), query: selector })
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
    context.get<LokiResponse<{ result: SampleStream[] }>>(context.uid, '/loki/api/v1/query_range', params, CATEGORIZE_LABELS)
  );
  return response.data.result;
}

async function logVolume(context: Context, selector: string): Promise<number> {
  const query = `sum(count_over_time(${selector}[${prometheusLookback(context.window)}]))`;
  const response = await context.limit(() =>
    context.get<LokiResponse<{ result: Array<{ value: [number, string] }> }>>(context.uid, '/loki/api/v1/query', { query, time: String(context.window.endSeconds) })
  );
  return Number(response.data.result[0]?.value[1] ?? 0);
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
  return [...new Set(metadataOf(streams).map((metadata) => metadata[key]).filter(Boolean))].sort();
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

async function guarded<T>(context: Context, step: string, task: () => Promise<T>): Promise<T | undefined> {
  try {
    return await task();
  } catch (error) {
    const candidate = (error ?? {}) as { data?: { error?: string; message?: string }; message?: string };
    context.errors.push({ datasource: context.uid, step, message: candidate.data?.error ?? candidate.data?.message ?? candidate.message ?? String(error) });
    return undefined;
  }
}
