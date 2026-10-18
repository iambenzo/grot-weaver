import { AssessmentResult, Finding, Ratio, Scores } from '../api/types';
import { groupViolations, ownersOfKind, serviceRows, uncheckableResourceFor } from './overview';

const ratio = (value: number | null): Ratio => ({ value, numerator: 0, denominator: value === null ? 0 : 1 });
const scores = (stable: number | null, rc: number | null = null, experimental: number | null = null): Scores => ({
  naming_stable: ratio(stable),
  naming_release_candidate: ratio(rc),
  naming_experimental: ratio(experimental),
  requirements: ratio(null),
  resource: ratio(1),
  required_resource: { value: 0.5, numerator: 1, denominator: 2 },
  deprecated: 0,
  unclassified: 0,
  custom: 0,
});
const checkout = { kind: 'service' as const, namespace: 'shop', name: 'checkout' };
const payments = { kind: 'service' as const, name: 'payments' };
const violation = (owner: typeof checkout | typeof payments, observed: string, library?: string): Finding => ({
  type: 'deprecated',
  level: 'violation',
  signal: 'traces',
  owner,
  observed,
  matched: observed,
  expected: 'http.request.method',
  volume: 5,
  impact_share: 0.1,
  library: library ? { name: library, evidence: 'x', confidence: 'high' } : undefined,
});

describe('groupViolations', () => {
  it('groups by name per signal, counting services and libraries', () => {
    const groups = groupViolations([
      violation(checkout, 'http.method', 'otel-http'),
      violation(payments, 'http.method', 'otel-http'),
      violation(payments, 'http.method', 'other-lib'),
      violation(checkout, 'net.peer.name'),
      { ...violation(checkout, 'x'), level: 'improvement' },
      { ...violation({ kind: 'source', name: 'node' } as unknown as typeof payments, 'http.method') },
    ]);

    expect(groups.map((group) => [group.name, group.services])).toEqual([
      ['http.method', 2],
      ['net.peer.name', 1],
    ]);
    expect(groups[0].libraries).toEqual(['otel-http', 'other-lib']);
    expect(groups[0].owners).toEqual([checkout, payments]);
  });

  it('keeps the names as sent when they group under one registry name', () => {
    const stored = (owner: typeof checkout | typeof payments, observed: string): Finding => ({
      ...violation(owner, observed),
      type: 'unit_mismatch',
      matched: 'http.server.request.duration',
      expected: 'http.server.request.duration',
    });

    const [group] = groupViolations([
      stored(checkout, 'http_server_request_duration_milliseconds_bucket'),
      stored(payments, 'http_server_request_duration_milliseconds_bucket'),
      stored(payments, 'http_server_request_duration_milliseconds_count'),
    ]);

    expect(group.name).toBe('http.server.request.duration');
    expect(group.observed).toEqual([
      'http_server_request_duration_milliseconds_bucket',
      'http_server_request_duration_milliseconds_count',
    ]);
  });
});

describe('serviceRows', () => {
  it('sorts services worst first and N/A last', () => {
    const result = {
      owners: [
        { owner: checkout, signal: 'traces', scores: scores(0.9) },
        { owner: checkout, signal: 'metrics', scores: scores(0.4, null, 1) },
        { owner: payments, signal: 'traces', scores: scores(0.7) },
        { owner: { kind: 'service', name: 'quiet' }, signal: 'traces', scores: scores(null) },
        { owner: { kind: 'source', name: 'node' }, signal: 'metrics', scores: scores(0) },
      ],
      findings: [violation(checkout, 'http.method')],
    } as unknown as AssessmentResult;

    const rows = serviceRows(result);

    expect(rows.map((row) => [row.owner.name, row.worst])).toEqual([
      ['checkout', 0.4],
      ['payments', 0.7],
      ['quiet', null],
    ]);
    expect(rows[0].violations).toBe(1);
    expect(rows[0].requiredResource).toEqual({ value: 0.5, numerator: 2, denominator: 4 });
  });
});

describe('ownersOfKind', () => {
  it('summarises non-service owners with origin and hints', () => {
    const result = {
      findings: [{ ...violation(checkout, 'x'), owner: { kind: 'unattributed', name: 'unattributed' } }],
      metric_attributions: [
        {
          owner: { kind: 'unattributed', name: 'unattributed' },
          origin: { origin: 'sdk', confidence: 'medium', reason: 'target_info carries telemetry_sdk_* labels' },
          hints: { telemetry_sdk_name: 'envoy' },
        },
      ],
    } as unknown as AssessmentResult;

    const [summary] = ownersOfKind(result, 'unattributed');

    expect(summary).toMatchObject({ violations: 1, findings: 1 });
    expect(summary.detail).toEqual(expect.arrayContaining(['telemetry_sdk_name=envoy']));
  });
});

describe('uncheckableResourceFor', () => {
  it('counts not-checkable required attributes on services for one signal', () => {
    const check = (signal: 'metrics' | 'traces', state: 'present' | 'unknown', kind: 'service' | 'source') => ({
      owner: { kind, name: 'x' },
      signal,
      attribute: 'deployment.environment.name',
      state,
      evidence: '',
    });
    const result = {
      resource_attributes: [
        check('metrics', 'unknown', 'service'),
        check('metrics', 'unknown', 'service'),
        check('metrics', 'present', 'service'),
        check('metrics', 'unknown', 'source'),
        check('traces', 'unknown', 'service'),
      ],
    } as unknown as AssessmentResult;

    expect(uncheckableResourceFor(result, 'metrics')).toBe(2);
  });
});
