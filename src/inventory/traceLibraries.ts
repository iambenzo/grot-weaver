import { ProxyGet } from '../datasources/proxy';
import { Limiter } from '../datasources/limiter';
import { QueryWindow, tempoWindowParams } from '../window/window';
import { attributeSelector, serviceFilterExpression } from './traceql';

const INSTRUMENTATION_NAME = 'instrumentation:name';
const INSTRUMENTATION_VERSION = 'instrumentation:version';
const SAMPLE_LIMIT = '20';
const SPANS_PER_SPAN_SET = '3';
const STEPS_PER_WINDOW = 20;
const MIN_STEP_SECONDS = 60;

export type LookupMethod = 'metrics' | 'sample';

export interface Library {
  name: string;
  version: string;
  spans?: number;
}

export interface LibraryEvidence {
  libraries: Library[];
  firstSeenMs?: number;
  lastSeenMs?: number;
  confidence: 'high' | 'medium';
  method: LookupMethod;
}

export interface FlaggedKey {
  serviceName: string;
  key: string;
  scope: 'resource' | 'span';
}

interface Attribute {
  key: string;
  value?: { stringValue?: string };
}

interface MetricsResponse {
  series?: Array<{ labels?: Attribute[]; samples?: Array<{ timestampMs: string; value?: number }> }>;
}

interface SearchResponse {
  traces?: Array<{ spanSets?: Array<{ spans?: Array<{ startTimeUnixNano?: string; attributes?: Attribute[] }> }> }>;
}

export interface LookupContext {
  uid: string;
  get: ProxyGet;
  limit: Limiter;
  window: QueryWindow;
}


export function flaggedKeyFilter(flagged: FlaggedKey): string {
  return `{ ${serviceFilterExpression(flagged.serviceName)} && ${attributeSelector(flagged.scope, flagged.key)} != nil }`;
}

export async function probeTraceQLMetrics(context: LookupContext): Promise<boolean> {
  try {
    await context.limit(() => context.get<MetricsResponse>(context.uid, '/api/metrics/query_range', metricsParams(context.window, '{ } | count_over_time()')));
    return true;
  } catch {
    return false;
  }
}

export async function lookupLibraries(context: LookupContext, flagged: FlaggedKey, metricsAvailable: boolean): Promise<LibraryEvidence> {
  if (metricsAvailable) {
    try {
      const evidence = await lookupWithMetrics(context, flagged);
      if (evidence.libraries.length > 0) {
        return evidence;
      }
    } catch {
      return lookupWithSample(context, flagged);
    }
  }
  return lookupWithSample(context, flagged);
}

async function lookupWithMetrics(context: LookupContext, flagged: FlaggedKey): Promise<LibraryEvidence> {
  const query = `${flaggedKeyFilter(flagged)} | count_over_time() by (${INSTRUMENTATION_NAME}, ${INSTRUMENTATION_VERSION})`;
  const response = await context.limit(() =>
    context.get<MetricsResponse>(context.uid, '/api/metrics/query_range', metricsParams(context.window, query))
  );
  const evidence: LibraryEvidence = { libraries: [], confidence: 'high', method: 'metrics' };
  for (const series of response.series ?? []) {
    const counted = (series.samples ?? []).filter((sample) => (sample.value ?? 0) > 0);
    const spans = counted.reduce((total, sample) => total + (sample.value ?? 0), 0);
    evidence.libraries.push({ ...libraryFrom(series.labels ?? []), spans });
    for (const sample of counted) {
      widenSeen(evidence, Number(sample.timestampMs));
    }
  }
  return evidence;
}

async function lookupWithSample(context: LookupContext, flagged: FlaggedKey): Promise<LibraryEvidence> {
  const query = `${flaggedKeyFilter(flagged)} | select(${INSTRUMENTATION_NAME}, ${INSTRUMENTATION_VERSION})`;
  const params = { ...tempoWindowParams(context.window), q: query, limit: SAMPLE_LIMIT, spss: SPANS_PER_SPAN_SET };
  const response = await context.limit(() => context.get<SearchResponse>(context.uid, '/api/search', params));
  const evidence: LibraryEvidence = { libraries: [], confidence: 'medium', method: 'sample' };
  const seen = new Map<string, Library>();
  for (const span of (response.traces ?? []).flatMap((trace) => (trace.spanSets ?? []).flatMap((set) => set.spans ?? []))) {
    const library = libraryFrom(span.attributes ?? []);
    const id = `${library.name}@${library.version}`;
    const existing = seen.get(id) ?? { ...library, spans: 0 };
    existing.spans = (existing.spans ?? 0) + 1;
    seen.set(id, existing);
    if (span.startTimeUnixNano) {
      widenSeen(evidence, Number(BigInt(span.startTimeUnixNano) / BigInt(1_000_000)));
    }
  }
  evidence.libraries = [...seen.values()];
  return evidence;
}

function metricsParams(window: QueryWindow, query: string): Record<string, string> {
  const step = Math.max(Math.ceil((window.endSeconds - window.startSeconds) / STEPS_PER_WINDOW), MIN_STEP_SECONDS);
  return { ...tempoWindowParams(window), q: query, step: `${step}s` };
}

function libraryFrom(attributes: Attribute[]): Library {
  const value = (key: string) => attributes.find((attribute) => attribute.key === key)?.value?.stringValue ?? '';
  return { name: value(INSTRUMENTATION_NAME), version: value(INSTRUMENTATION_VERSION) };
}

function widenSeen(evidence: LibraryEvidence, timestampMs: number) {
  evidence.firstSeenMs = evidence.firstSeenMs === undefined ? timestampMs : Math.min(evidence.firstSeenMs, timestampMs);
  evidence.lastSeenMs = evidence.lastSeenMs === undefined ? timestampMs : Math.max(evidence.lastSeenMs, timestampMs);
}
