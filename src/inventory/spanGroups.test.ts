import { ProxyGet } from '../datasources/proxy';
import { createLimiter } from '../datasources/limiter';
import { SpanGroupRule } from '../api/catalogue';
import { applicableRules, sampleSpanGroup, spanGroupQuery } from './spanGroups';

const httpServer: SpanGroupRule = {
  id: 'span.http.server',
  span_kind: 'server',
  identifying: 'http.request.method',
  required: ['http.request.method', 'url.path', 'url.scheme'],
  recommended: ['http.route'],
  stability: 'stable',
};
const dbClient: SpanGroupRule = { ...httpServer, id: 'span.db.client', span_kind: 'client', identifying: 'db.system.name', required: ['db.system.name'], recommended: [] };

const span = (...keys: string[]) => ({ attributes: keys.map((key) => ({ key, value: { stringValue: 'x' } })) });

describe('applicableRules', () => {
  it('keeps only groups whose identifying attribute the service sends', () => {
    expect(applicableRules([httpServer, dbClient], ['http.request.method', 'url.path'])).toEqual([httpServer]);
  });
});

describe('spanGroupQuery', () => {
  it('filters on service, kind and the identifying attribute, and selects the group attributes', () => {
    expect(spanGroupQuery('checkout', httpServer)).toBe(
      '{ resource.service.name = "checkout" && kind = server && span.http.request.method != nil } | select(span.http.request.method, span.url.path, span.url.scheme, span.http.route)'
    );
  });
});

describe('sampleSpanGroup', () => {
  it('counts sampled spans and attribute presence', async () => {
    const calls: Array<Record<string, string>> = [];
    const get = (async (_uid: string, _path: string, params: Record<string, string>) => {
      calls.push(params);
      return { traces: [{ spanSets: [{ spans: [span('http.request.method', 'url.path', 'url.scheme'), span('http.request.method', 'url.path', 'service.name')] }] }, { spanSets: [{ spans: [span('http.request.method')] }] }] };
    }) as ProxyGet;

    const sample = await sampleSpanGroup({ uid: 'tempo', get, limit: createLimiter(1), window: { startSeconds: 1, endSeconds: 2 } }, 'checkout', httpServer);

    expect(sample).toEqual({ group: 'span.http.server', sampled: 3, present: { 'http.request.method': 3, 'url.path': 2, 'url.scheme': 1 } });
    expect(calls[0]).toMatchObject({ limit: '20', spss: '3', start: '1', end: '2' });
  });
});
