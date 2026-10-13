import { ProxyGet } from '../datasources/proxy';
import { Limiter } from '../datasources/limiter';
import { QueryWindow, tempoWindowParams } from '../window/window';
import { CollectionError, KeyObservation, SDK, TraceDatasource, TraceService } from './types';

const SERVICE_NAME_TAG = 'resource.service.name';
const SERVICE_NAMESPACE_TAG = 'resource.service.namespace';

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

export interface TempoCollection {
  datasource: TraceDatasource;
  errors: CollectionError[];
}

interface CollectorContext {
  uid: string;
  get: ProxyGet;
  limit: Limiter;
  window: QueryWindow;
  errors: CollectionError[];
}

export function serviceFilter(serviceName: string): string {
  const escaped = serviceName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `{ ${SERVICE_NAME_TAG} = "${escaped}" }`;
}

export async function collectTempoInventory(uid: string, get: ProxyGet, limit: Limiter, window: QueryWindow): Promise<TempoCollection> {
  const context: CollectorContext = { uid, get, limit, window, errors: [] };
  const serviceNames = await guarded(context, 'service names', () => tagValues(context, SERVICE_NAME_TAG));
  const services = await Promise.all((serviceNames ?? []).map((name) => collectService(context, name)));
  return { datasource: { uid, services }, errors: context.errors };
}

async function collectService(context: CollectorContext, serviceName: string): Promise<TraceService> {
  const filter = serviceFilter(serviceName);
  const step = (what: string) => `${what} for service "${serviceName}"`;
  const [resourceKeys, spanKeys, namespaces, sdk] = await Promise.all([
    guarded(context, step('resource keys'), () => scopedTags(context, 'resource', filter)),
    guarded(context, step('span keys'), () => scopedTags(context, 'span', filter)),
    guarded(context, step('namespace'), () => tagValues(context, SERVICE_NAMESPACE_TAG, filter)),
    collectSDK(context, filter, step),
  ]);
  return {
    service_name: serviceName,
    service_namespace: namespaces?.[0] ?? '',
    span_count: 0,
    resource_keys: observations(resourceKeys),
    span_keys: observations(spanKeys),
    sdk,
  };
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

async function guarded<T>(context: CollectorContext, step: string, task: () => Promise<T>): Promise<T | undefined> {
  try {
    return await task();
  } catch (error) {
    context.errors.push({ datasource: context.uid, step, message: errorMessage(error) });
    return undefined;
  }
}

function observations(keys: string[] | undefined): KeyObservation[] {
  return [...new Set(keys ?? [])].sort().map((key) => ({ key, volume: 0 }));
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const candidate = error as { data?: { message?: string }; message?: string; status?: number };
    return candidate.data?.message ?? candidate.message ?? `request failed with status ${candidate.status ?? 'unknown'}`;
  }
  return String(error);
}
