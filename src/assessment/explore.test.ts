import { AssessmentResult, Finding } from '../api/types';
import { evidenceTarget, exploreUrl } from './explore';

const checkout = { kind: 'service' as const, namespace: 'shop', name: 'checkout' };
const result = {
  attributions: [{ owner: checkout, datasource: 'tempo' }],
  metric_attributions: [{ owner: checkout, datasource: 'prom', source: 'job label (SDK origin)' }],
  log_attributions: [{ owner: checkout, datasource: 'loki' }],
  datasources: [],
} as unknown as AssessmentResult;
const types: Record<string, string> = { tempo: 'tempo', prom: 'prometheus', loki: 'loki' };
const typeOf = (uid: string) => types[uid];
const base: Finding = {
  type: 'deprecated',
  signal: 'traces',
  owner: checkout,
  observed: 'http.method',
  scope: 'spans',
  volume: 0,
  impact_share: 0,
};

describe('evidenceTarget', () => {
  it.each([
    [
      'trace attribute',
      base,
      'tempo',
      '{ resource.service.name = "checkout" && resource.service.namespace = "shop" && span.http.method != nil }',
    ],
    [
      'resource attribute',
      { ...base, scope: 'resources', observed: 'telemetry.auto.version' },
      'tempo',
      '{ resource.service.name = "checkout" && resource.service.namespace = "shop" && resource.telemetry.auto.version != nil }',
    ],
    [
      'metric name',
      { ...base, signal: 'metrics', observed: 'http_server_duration_milliseconds_bucket', scope: undefined },
      'prom',
      'count by (__name__) ({__name__=~"http_server_duration_milliseconds_bucket", job="shop/checkout"})',
    ],
    [
      'metric label',
      {
        ...base,
        signal: 'metrics',
        observed: 'http_method',
        scope: 'metrics',
        metrics: ['http_server_request_duration_seconds_bucket'],
      },
      'prom',
      'count by (__name__) ({__name__=~"http_server_request_duration_seconds_bucket", http_method!="", job="shop/checkout"})',
    ],
    [
      'log key',
      { ...base, signal: 'logs', observed: 'http_method', scope: 'logs' },
      'loki',
      '{service_name="checkout"} | http_method != ""',
    ],
  ] as Array<[string, Finding, string, string]>)('%s', (_name, finding, uid, query) => {
    expect(evidenceTarget(finding, result, typeOf)).toEqual({ uid, type: types[uid], query });
  });

  it('queries every histogram part of an aggregated metric name finding', () => {
    const finding: Finding = {
      ...base,
      signal: 'metrics',
      scope: undefined,
      observed: 'h_ms',
      metrics: ['h_ms_bucket', 'h_ms_sum'],
    };
    expect(evidenceTarget(finding, result, typeOf)?.query).toBe(
      'count by (__name__) ({__name__=~"h_ms_bucket|h_ms_sum", job="shop/checkout"})'
    );
  });

  it('returns nothing when the datasource is unknown', () => {
    expect(evidenceTarget({ ...base, owner: { kind: 'service', name: 'ghost' } }, result, typeOf)).toBeUndefined();
  });
});

describe('exploreUrl', () => {
  it('builds an Explore pane for TraceQL and PromQL', () => {
    const tempo = decodeURIComponent(exploreUrl({ uid: 'tempo', type: 'tempo', query: '{ }' }, 'now-24h', 'now'));
    expect(tempo).toContain('"queryType":"traceql","query":"{ }"');
    expect(tempo).toContain('"range":{"from":"now-24h","to":"now"}');
    const prom = decodeURIComponent(exploreUrl({ uid: 'prom', type: 'prometheus', query: 'up' }, 'now-1h', 'now'));
    expect(prom).toMatch(/^\/explore\?schemaVersion=1&panes=/);
    expect(prom).toContain('"expr":"up"');
  });
});
