import { Finding } from '../api/types';
import { ownerSummary } from './summary';

const owner = { kind: 'service' as const, namespace: 'shop', name: 'checkout' };
const base: Finding = {
  type: 'deprecated',
  level: 'violation',
  signal: 'traces',
  owner,
  observed: 'http.method',
  scope: 'spans',
  matched: 'http.method',
  expected: 'http.request.method',
  volume: 3,
  impact_share: 0.2,
};

describe('ownerSummary', () => {
  it('names the service, finding, expected name, library and evidence query', () => {
    const summary = ownerSummary(
      owner,
      [
        {
          finding: base,
          library: { name: '@opentelemetry/instrumentation-http', version: '0.218.0' },
          evidence: {
            url: '/explore',
            query: '{ resource.service.name = "checkout" && span.http.method != nil }',
            datasource: 'Tempo',
          },
        },
      ],
      'v1.44.0'
    );

    expect(summary).toBe(
      [
        'OpenTelemetry semantic convention findings for shop/checkout (semconv v1.44.0)',
        '',
        '1. deprecated name: http.method, expected http.request.method (traces, spans)',
        '   Library or SDK: @opentelemetry/instrumentation-http 0.218.0',
        '   Evidence (Tempo): { resource.service.name = "checkout" && span.http.method != nil }',
      ].join('\n')
    );
  });

  it('describes missing requirements, deprecations without a replacement and unknown libraries', () => {
    const missing: Finding = {
      ...base,
      type: 'required_attribute_not_present',
      observed: 'span.http.server',
      expected: 'url.scheme',
    };
    const noReplacement: Finding = {
      ...base,
      observed: 'net.peer.name',
      expected: undefined,
      note: 'Use server.address on client spans.',
    };

    const summary = ownerSummary(
      { kind: 'service', name: 'flagd' },
      [{ finding: missing }, { finding: noReplacement }],
      'v1.44.0'
    );

    expect(summary).toContain('findings for flagd (');
    expect(summary).toContain('1. required attribute missing: url.scheme on span.http.server (traces, spans)');
    expect(summary).toContain('2. deprecated name: net.peer.name, no single replacement (traces, spans)');
    expect(summary).toContain('   Registry note: Use server.address on client spans.');
    expect(summary).toContain('   Library or SDK: unknown');
  });

  it('falls back to the library carried by a metric finding', () => {
    const metric: Finding = {
      ...base,
      signal: 'metrics',
      scope: undefined,
      library: { name: 'opentelemetry-go', version: '1.30.0', evidence: 'telemetry_sdk_*', confidence: 'medium' },
    };

    expect(ownerSummary(owner, [{ finding: metric }], 'v1.44.0')).toContain('Library or SDK: opentelemetry-go 1.30.0');
  });
});
