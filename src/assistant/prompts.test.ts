import { Finding } from '../api/types';
import { ViolationGroup } from '../assessment/overview';
import { findingPrompt, violationPrompt } from './prompts';

const owner = { kind: 'service' as const, namespace: 'shop', name: 'checkout' };
const renamed: Finding = {
  type: 'deprecated',
  level: 'violation',
  signal: 'traces',
  owner,
  observed: 'http.method',
  scope: 'spans',
  expected: 'http.request.method',
  volume: 3,
  impact_share: 0.2,
};
const evidence = { url: '/explore', query: '{ span.http.method != nil }', datasource: 'Tempo' };

describe('findingPrompt', () => {
  it('asks what uses the old name and how to move it, followed by the owner summary', () => {
    const prompt = findingPrompt({ finding: renamed, evidence }, 'v1.44.0');

    expect(prompt).toBe(
      [
        'Find the dashboards, alert rules and recording rules in this stack that use `http.method`, and explain how to move each one to `http.request.method` without a gap in their data.',
        '',
        'OpenTelemetry semantic convention findings for shop/checkout (semconv v1.44.0)',
        '',
        '1. deprecated name: http.method, expected http.request.method (traces, spans)',
        '   Library or SDK: unknown',
        '   Evidence (Tempo): { span.http.method != nil }',
      ].join('\n')
    );
  });

  it('asks how to add a missing attribute', () => {
    const missing: Finding = {
      ...renamed,
      type: 'required_attribute_not_present',
      observed: 'http.server.request.duration',
      expected: 'http.request.method',
    };

    expect(findingPrompt({ finding: missing }, 'v1.44.0')).toMatch(
      /^Explain how to add `http\.request\.method` to `http\.server\.request\.duration`, in the instrumentation or in the pipeline,/
    );
  });

  it('asks for an explanation when there is no expected name', () => {
    const unknown: Finding = { ...renamed, type: 'not_in_registry', expected: undefined, observed: 'shop.cart.size' };

    expect(findingPrompt({ finding: unknown }, 'v1.44.0')).toMatch(
      /^Explain this finding and how to fix it, and find the dashboards, alert rules and recording rules in this stack that use `shop\.cart\.size`\./
    );
  });
});

describe('findingPrompt asks by finding type', () => {
  it.each<[Partial<Finding>, RegExp]>([
    [
      {
        type: 'unit_mismatch',
        observed: 'http_server_duration_milliseconds',
        expected: 'http.server.request.duration',
      },
      /^`http_server_duration_milliseconds` uses a different unit from the semantic convention for `http\.server\.request\.duration`\./,
    ],
    [{ type: 'deprecated', expected: undefined }, /^`http\.method` is deprecated with no single replacement\./],
    [{ type: 'misplaced_attribute' }, /^`http\.method` is set at the wrong scope\./],
    [
      { type: 'sdk_default_service_name', observed: 'unknown_service:python', expected: 'service.name' },
      /^This telemetry uses the SDK default service name `unknown_service:python`\./,
    ],
    [
      { type: 'missing_service_name', observed: '', expected: 'service.name' },
      /^This telemetry has no service\.name\./,
    ],
  ])('%p', (change, expected) => {
    expect(findingPrompt({ finding: { ...renamed, ...change } }, 'v1.44.0')).toMatch(expected);
  });

  it('never asks to move a name to service.name', () => {
    for (const type of ['sdk_default_service_name', 'missing_service_name'] as const) {
      expect(findingPrompt({ finding: { ...renamed, type, expected: 'service.name' } }, 'v1')).not.toMatch(
        /move each one to/
      );
    }
  });
});

describe('violationPrompt', () => {
  const group: ViolationGroup = {
    key: 'traces|deprecated|http.method',
    signal: 'traces',
    type: 'deprecated',
    name: 'http.method',
    observed: ['http.method'],
    expected: 'http.request.method',
    note: 'Replaced by http.request.method.',
    services: 2,
    owners: [owner, { kind: 'service', name: 'payments' }],
    libraries: ['@opentelemetry/instrumentation-http'],
    volume: 10,
    impactShare: 0.4,
  };

  it('names the services, libraries, time range and semconv version', () => {
    const prompt = violationPrompt(group, { from: 'now-1h', to: 'now' }, 'v1.44.0');

    expect(prompt).toBe(
      [
        'Find the dashboards, alert rules and recording rules in this stack that use `http.method`, and explain how to move each one to `http.request.method` without a gap in their data.',
        '',
        'OpenTelemetry semantic convention finding across 2 services (semconv v1.44.0, time range now-1h to now)',
        '',
        'deprecated name: http.method, expected http.request.method (traces)',
        'Registry note: Replaced by http.request.method.',
        'Services: shop/checkout, payments',
        'Libraries or SDKs: @opentelemetry/instrumentation-http',
      ].join('\n')
    );
  });

  it('asks about the names as sent when they differ from the registry name', () => {
    const stored = violationPrompt(
      {
        ...group,
        type: 'unit_mismatch',
        name: 'http.server.request.duration',
        observed: [
          'http_server_request_duration_milliseconds_bucket',
          'http_server_request_duration_milliseconds_count',
        ],
        expected: 'http.server.request.duration',
        note: undefined,
      },
      { from: 'now-1h', to: 'now' },
      'v1.44.0'
    );

    expect(stored).toMatch(
      /^`http_server_request_duration_milliseconds_bucket`, `http_server_request_duration_milliseconds_count` use a different unit/
    );
    expect(stored).toContain(
      'Sent as: http_server_request_duration_milliseconds_bucket, http_server_request_duration_milliseconds_count'
    );
  });

  it('lists at most ten services and counts the rest', () => {
    const owners = Array.from({ length: 12 }, (_, index) => ({ kind: 'service' as const, name: `svc-${index}` }));

    const prompt = violationPrompt({ ...group, owners, services: 12, libraries: [] }, { from: 'a', to: 'b' }, 'v1');

    expect(prompt).toContain(
      'Services: svc-0, svc-1, svc-2, svc-3, svc-4, svc-5, svc-6, svc-7, svc-8, svc-9 and 2 more'
    );
    expect(prompt).toContain('Libraries or SDKs: unknown');
  });
});
