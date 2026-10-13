import { SpanGroupRule } from '../api/catalogue';
import { ProxyGet } from '../datasources/proxy';
import { Limiter } from '../datasources/limiter';
import { QueryWindow, tempoWindowParams } from '../window/window';
import { attributeSelector, serviceFilterExpression } from './traceql';
import { SpanGroupSample } from './types';

const DEFAULT_SAMPLE_LIMIT = 20;
const SPANS_PER_SPAN_SET = '3';

interface SearchResponse {
  traces?: Array<{ spanSets?: Array<{ spans?: Array<{ attributes?: Array<{ key: string }> }> }> }>;
}

export interface SamplerContext {
  uid: string;
  get: ProxyGet;
  limit: Limiter;
  window: QueryWindow;
  sampleLimit?: number;
}

export function applicableRules(rules: SpanGroupRule[], spanKeys: string[]): SpanGroupRule[] {
  const present = new Set(spanKeys);
  return rules.filter((rule) => present.has(rule.identifying));
}

export function spanGroupQuery(serviceName: string, rule: SpanGroupRule): string {
  const attributes = [...new Set([...rule.required, ...rule.recommended])].map((name) =>
    attributeSelector('span', name)
  );
  const filter = `{ ${serviceFilterExpression(serviceName)} && kind = ${rule.span_kind} && ${attributeSelector('span', rule.identifying)} != nil }`;
  return `${filter} | select(${attributes.join(', ')})`;
}

export async function sampleSpanGroup(
  context: SamplerContext,
  serviceName: string,
  rule: SpanGroupRule
): Promise<SpanGroupSample> {
  const params = {
    ...tempoWindowParams(context.window),
    q: spanGroupQuery(serviceName, rule),
    limit: String(context.sampleLimit ?? DEFAULT_SAMPLE_LIMIT),
    spss: SPANS_PER_SPAN_SET,
  };
  const response = await context.limit(() => context.get<SearchResponse>(context.uid, '/api/search', params));
  const spans = (response.traces ?? []).flatMap((trace) => (trace.spanSets ?? []).flatMap((set) => set.spans ?? []));
  const present: Record<string, number> = {};
  for (const span of spans) {
    for (const key of new Set((span.attributes ?? []).map((attribute) => attribute.key))) {
      if (rule.required.includes(key) || rule.recommended.includes(key)) {
        present[key] = (present[key] ?? 0) + 1;
      }
    }
  }
  return { group: rule.id, sampled: spans.length, present };
}
