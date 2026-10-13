import { ProxyGet } from '../datasources/proxy';
import { Limiter } from '../datasources/limiter';
import { QueryWindow, tempoWindowParams } from '../window/window';

export type KeysMethod = 'tags' | 'sample';

const FILTER_PROBE_SERVICE = 'semconv-compliance-filter-probe';
const IGNORED_FILTER_SHARE = 0.9;
const DEFAULT_KEY_SAMPLE_TRACES = 5;
const SERVICE_NAME_KEY = 'service.name';

export interface KeysContext {
  uid: string;
  get: ProxyGet;
  limit: Limiter;
  window: QueryWindow;
  sampleLimit?: number;
}

export interface SampledKeys {
  resource: string[];
  span: string[];
}

interface TagsResponse {
  scopes?: Array<{ name: string; tags?: string[] }>;
}

interface OtlpAttribute {
  key: string;
  value?: { stringValue?: string };
}

interface OtlpResourceSpans {
  resource?: { attributes?: OtlpAttribute[] };
  scopeSpans?: Array<{ spans?: Array<{ attributes?: OtlpAttribute[] }> }>;
}

interface TraceResponse {
  trace?: { resourceSpans?: OtlpResourceSpans[] };
  resourceSpans?: OtlpResourceSpans[];
  batches?: OtlpResourceSpans[];
}

interface SearchResponse {
  traces?: Array<{ traceID?: string }>;
}

export async function isTagFilterIgnored(context: KeysContext): Promise<boolean> {
  const [unfiltered, probe] = await Promise.all([
    spanTags(context),
    spanTags(context, `{ resource.service.name = "${FILTER_PROBE_SERVICE}" }`),
  ]);
  return unfiltered.length > 0 && probe.length >= unfiltered.length * IGNORED_FILTER_SHARE;
}

export async function sampleServiceKeys(
  context: KeysContext,
  serviceName: string,
  filter: string
): Promise<SampledKeys> {
  const traceLimit = Math.min(context.sampleLimit ?? DEFAULT_KEY_SAMPLE_TRACES, DEFAULT_KEY_SAMPLE_TRACES);
  const search = await context.limit(() =>
    context.get<SearchResponse>(context.uid, '/api/search', {
      ...tempoWindowParams(context.window),
      q: filter,
      limit: String(traceLimit),
    })
  );
  const traceIds = (search.traces ?? []).flatMap((trace) => (trace.traceID ? [trace.traceID] : []));
  const traces = await Promise.all(
    traceIds.map((traceId) =>
      context.limit(() => context.get<TraceResponse>(context.uid, `/api/v2/traces/${encodeURIComponent(traceId)}`, {}))
    )
  );
  const resource = new Set<string>();
  const span = new Set<string>();
  for (const resourceSpans of traces.flatMap(resourceSpansOf)) {
    const attributes = resourceSpans.resource?.attributes ?? [];
    if (serviceNameOf(attributes) !== serviceName) {
      continue;
    }
    attributes.forEach((attribute) => resource.add(attribute.key));
    for (const scopeSpans of resourceSpans.scopeSpans ?? []) {
      for (const sampled of scopeSpans.spans ?? []) {
        (sampled.attributes ?? []).forEach((attribute) => span.add(attribute.key));
      }
    }
  }
  return { resource: [...resource].sort(), span: [...span].sort() };
}

async function spanTags(context: KeysContext, filter?: string): Promise<string[]> {
  const params: Record<string, string> = { ...tempoWindowParams(context.window), scope: 'span' };
  if (filter) {
    params.q = filter;
  }
  const response = await context.limit(() => context.get<TagsResponse>(context.uid, '/api/v2/search/tags', params));
  return (response.scopes ?? []).filter((entry) => entry.name === 'span').flatMap((entry) => entry.tags ?? []);
}

function resourceSpansOf(response: TraceResponse): OtlpResourceSpans[] {
  return response.trace?.resourceSpans ?? response.resourceSpans ?? response.batches ?? [];
}

function serviceNameOf(attributes: OtlpAttribute[]): string {
  return attributes.find((attribute) => attribute.key === SERVICE_NAME_KEY)?.value?.stringValue ?? '';
}
