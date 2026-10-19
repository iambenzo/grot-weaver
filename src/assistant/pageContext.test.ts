import { AssessmentResult, Finding, Owner, Ratio, Scores } from '../api/types';
import { DatasourceProgress, StackAssessment } from '../assessment/stackAssessment';
import {
  MAX_CONTEXT_FINDINGS,
  MAX_CONTEXT_LIMITS,
  MAX_CONTEXT_LIST,
  MAX_CONTEXT_SERVICES,
  MAX_CONTEXT_VIOLATIONS,
  PageScan,
  overviewContextData,
  serviceContextData,
} from './pageContext';

const ratio = (numerator: number, denominator: number): Ratio => ({
  value: denominator === 0 ? null : numerator / denominator,
  numerator,
  denominator,
});
const scores = (stable: Ratio): Scores => ({
  naming_stable: stable,
  naming_release_candidate: ratio(0, 0),
  naming_experimental: ratio(0, 0),
  requirements: ratio(3, 4),
  resource: ratio(1, 1),
  required_resource: ratio(0, 0),
  deprecated: 1,
  unclassified: 0,
  custom: 0,
});
const service = (index: number): Owner => ({ kind: 'service', namespace: 'shop', name: `svc-${index}` });
const checkout: Owner = { kind: 'service', namespace: 'shop', name: 'checkout' };
const finding = (owner: Owner, observed: string, impact: number): Finding => ({
  type: 'deprecated',
  level: 'violation',
  signal: 'traces',
  owner,
  observed,
  matched: observed,
  scope: 'spans',
  expected: `${observed}.new`,
  volume: 1,
  impact_share: impact,
});
const tempo: DatasourceProgress = {
  ref: { uid: 'tempo', name: 'Tempo', type: 'tempo' },
  signal: 'traces',
  state: 'ok',
  errors: [],
  keysMethod: 'sample',
};

function scanOf(
  result: Partial<AssessmentResult>,
  overrides: Partial<PageScan> = {},
  shownProgress: DatasourceProgress[] = overrides.progress ?? [tempo]
): PageScan {
  const assessment = {
    result: {
      semconv_version: 'v1.44.0',
      window: { start: 0, end: 3600 },
      findings: [],
      attributions: [],
      owners: [],
      namespaces: [],
      signals: [],
      ...result,
    },
    errors: [],
    datasources: { metrics: [], traces: [], logs: [] },
    collections: [],
    progress: shownProgress,
    partial: false,
  } as StackAssessment;
  return { assessment, progress: [tempo], scanning: false, ...overrides };
}

describe('overviewContextData', () => {
  const violations = Array.from({ length: MAX_CONTEXT_VIOLATIONS + 5 }, (_, index) =>
    finding(service(index), `attr.${index}`, 0.01)
  );
  const owners = Array.from({ length: MAX_CONTEXT_SERVICES + 3 }, (_, index) => ({
    owner: service(index),
    signal: 'traces' as const,
    scores: scores(ratio(index, 20)),
  }));

  it('carries the scores as shown, with their basis and meaning', () => {
    const data = overviewContextData(
      scanOf({ signals: [{ owner: checkout, signal: 'traces', scores: scores(ratio(10, 12)) }] }),
      'Last 1 hour',
      false
    );

    expect(data.semconvVersion).toBe('v1.44.0');
    expect(data.timeRange).toBe('Last 1 hour');
    expect(data.counting).toBe('each name counts once per service');
    expect(data.scores.traces[0]).toEqual({ label: 'Naming: Stable', value: '83%', basis: '10 of 12 names' });
    expect(data.scoreMeanings['Naming: Stable']).toBe('Share of observed names in the Stable bucket that are current');
    expect(data.scores.metrics[0].value).toBe('N/A');
  });

  it('caps the violations and services it sends and says how many there are', () => {
    const data = overviewContextData(scanOf({ findings: violations, owners }), 'Last 1 hour', false);

    expect(data.topViolations.shown).toBe(MAX_CONTEXT_VIOLATIONS);
    expect(data.topViolations.total).toBe(MAX_CONTEXT_VIOLATIONS + 5);
    expect(data.topViolations.items).toHaveLength(MAX_CONTEXT_VIOLATIONS);
    expect(data.topViolations.items[0].finding).toMatch(
      /^deprecated name: attr\.\d+, expected attr\.\d+\.new \(traces\)$/
    );
    expect(data.servicesWorstFirst).toMatchObject({ shown: MAX_CONTEXT_SERVICES, total: MAX_CONTEXT_SERVICES + 3 });
    expect(data.servicesWorstFirst.items[0]).toEqual({ service: 'shop/svc-0', lowestNamingScore: '0%', violations: 1 });
  });

  it('says when the scores are not final and which checks were limited', () => {
    const running = overviewContextData(
      scanOf({}, { scanning: true, progress: [{ ...tempo, state: 'pending' }] }),
      'Last 1 hour',
      false
    );
    const finished = overviewContextData(scanOf({}), 'Last 1 hour', false);

    expect(running.scan.scoresFinal).toBe(false);
    expect(running.scan.freshScanRunning).toBe(true);
    expect(running.scan.status).toMatch(/so far/);
    expect(finished.scan.scoresFinal).toBe(true);
    expect(finished.scan.freshScanRunning).toBe(false);
    expect(finished.scan.limitedChecks).toEqual({
      shown: 1,
      total: 1,
      items: ['Tempo: keys from sample, Tempo ignores the per-service tag filter so rare attributes can be missed'],
    });
    expect(finished.scan.basedOnLimitedData).toEqual({ traces: { shown: 1, total: 1, items: ['keys from a sample'] } });
  });
});

describe('context size', () => {
  it('stays small on a stack with many name variants, libraries, datasources and findings', () => {
    const many = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `${prefix}-${index}`);
    const progress: DatasourceProgress[] = many('tempo', 40).map((uid) => ({
      ...tempo,
      ref: { uid, name: `${uid}-${'n'.repeat(5000)}`, type: 'tempo' },
    }));
    const long = 'x'.repeat(5000);
    const findings = many(`name-${long}`, 200).flatMap((name, index) =>
      many(`variant-${long}`, 30).map((variant) => ({
        ...finding(service(index % 50), `${name}.${variant}`, 0.01),
        note: long,
        matched: name,
        expected: `${name}.new`,
        library: { name: `lib-${variant}`, version: '1.0.0', evidence: 'sdk', confidence: 'high' as const },
      }))
    );
    const owners = many('svc', 50).map((_, index) => ({
      owner: service(index),
      signal: 'traces' as const,
      scores: scores(ratio(1, 2)),
    }));

    const overview = overviewContextData(scanOf({ findings, owners }, { progress }), 'Last 30 days', false);
    const servicePage = serviceContextData(
      scanOf({ findings, owners }, { progress }),
      service(0),
      'Last 30 days',
      false,
      false
    );

    expect(overview.topViolations.items[0].sentAs).toMatchObject({ shown: MAX_CONTEXT_LIST, total: 30 });
    expect(overview.scan.limitedChecks).toMatchObject({ shown: MAX_CONTEXT_LIMITS, total: 40 });
    expect(Buffer.byteLength(JSON.stringify(overview))).toBeLessThan(40_000);
    expect(Buffer.byteLength(JSON.stringify(servicePage))).toBeLessThan(40_000);
  });
});

describe('serviceContextData', () => {
  it('sends the service, its scores without coverage, and its findings worst first, capped', () => {
    const own = Array.from({ length: MAX_CONTEXT_FINDINGS + 2 }, (_, index) =>
      finding(checkout, `attr.${index}`, index / 100)
    );
    const data = serviceContextData(
      scanOf({
        findings: [...own, finding(service(1), 'other', 0.9), { ...finding(checkout, 'ok', 1), type: 'conformant' }],
        owners: [{ owner: checkout, signal: 'traces', scores: scores(ratio(1, 2)) }],
      }),
      checkout,
      'Last 1 hour',
      false,
      true
    );

    expect(data.service).toBe('shop/checkout');
    expect(data.quickView).toMatch(/Only this service has been scanned/);
    expect(data.scores.traces.map((tile) => tile.label)).not.toContain('Coverage');
    expect(data.findings).toMatchObject({ shown: MAX_CONTEXT_FINDINGS, total: MAX_CONTEXT_FINDINGS + 2 });
    expect(data.findings.items[0]).toEqual({
      level: 'violation',
      finding: `deprecated name: attr.${MAX_CONTEXT_FINDINGS + 1}, expected attr.${MAX_CONTEXT_FINDINGS + 1}.new (traces, spans)`,
      impact: '21%',
    });
  });

  it('names the library behind a finding when it is known', () => {
    const traced = {
      ...finding(checkout, 'http.method', 0.5),
      library: {
        name: '@opentelemetry/instrumentation-http',
        version: '0.218.0',
        evidence: 'scope',
        confidence: 'high' as const,
      },
    };

    const data = serviceContextData(scanOf({ findings: [traced] }), checkout, 'Last 1 hour', false, false);

    expect(data.findings.items[0].library).toBe('@opentelemetry/instrumentation-http 0.218.0');
  });

  it('treats a saved scan as final while a fresh one runs', () => {
    const saved = serviceContextData(
      scanOf({}, { savedAtMs: Date.now(), scanning: true, progress: [{ ...tempo, state: 'pending' }] }, [tempo]),
      checkout,
      'Last 1 hour',
      false,
      false
    );

    expect(saved.scan).toMatchObject({ scoresFinal: true, freshScanRunning: true });
    expect(saved.scan.basedOnLimitedData).toEqual({ traces: { shown: 1, total: 1, items: ['keys from a sample'] } });
  });

  it('leaves out the quick view note after the full scan', () => {
    expect(serviceContextData(scanOf({}), checkout, 'Last 1 hour', false, false)).not.toHaveProperty('quickView');
  });
});
