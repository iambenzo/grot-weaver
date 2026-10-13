import { assessTraces, isFlaggedTraceKey, lookupFindingLibraries } from './traceAssessment';
import { ProxyGet } from '../datasources/proxy';
import { createLimiter } from '../datasources/limiter';
import { AssessmentResult, Finding } from '../api/types';

const window = { startSeconds: 10, endSeconds: 20 };
const owner = { kind: 'service' as const, name: 'checkout' };
const base: Finding = {
  type: 'deprecated',
  level: 'violation',
  signal: 'traces',
  owner,
  observed: 'http.method',
  scope: 'spans',
  volume: 0,
  impact_share: 0,
};

describe('assessTraces', () => {
  it('collects every datasource and scores them together', async () => {
    const get = (async (uid: string, requestPath: string) => {
      if (requestPath.endsWith('resource.service.name/values')) {
        return { tagValues: [{ value: `svc-${uid}` }] };
      }
      return requestPath === '/api/v2/search/tags' ? { scopes: [] } : { tagValues: [] };
    }) as ProxyGet;
    const score = jest.fn(async () => ({ findings: [] }) as unknown as AssessmentResult);

    await assessTraces(
      [
        { uid: 'a', type: 'tempo', name: 'A' },
        { uid: 'b', type: 'tempo', name: 'B' },
      ],
      window,
      { get, limit: createLimiter(2), score, spanGroupRules: async () => [] }
    );

    const [inventory, weighted] = score.mock.calls[0] as unknown as [
      { window: unknown; traces: Array<{ uid: string }> },
      boolean,
    ];
    expect(inventory.window).toEqual({ start: 10, end: 20 });
    expect(inventory.traces.map((trace) => trace.uid)).toEqual(['a', 'b']);
    expect(weighted).toBe(false);

    await assessTraces([], window, { get, limit: createLimiter(1), score, spanGroupRules: async () => [] }, true);
    expect((score.mock.calls[1] as unknown as [unknown, boolean])[1]).toBe(true);
  });
});

describe('isFlaggedTraceKey', () => {
  it.each([
    ['deprecated span key', base, true],
    ['conformant', { ...base, type: 'conformant', level: '' }, false],
    ['custom information', { ...base, type: 'custom', level: 'information' }, false],
    ['identity finding without key', { ...base, type: 'missing_service_name', observed: '', scope: undefined }, false],
    ['metric finding', { ...base, signal: 'metrics' }, false],
  ] as Array<[string, Finding, boolean]>)('%s', (_name, finding, expected) => {
    expect(isFlaggedTraceKey(finding)).toBe(expected);
  });
});

describe('lookupFindingLibraries', () => {
  it('probes metrics once per datasource and maps resource scope', async () => {
    const queries: string[] = [];
    const get = (async (_uid: string, requestPath: string, params: Record<string, string>) => {
      queries.push(`${requestPath} ${params.q}`);
      return requestPath === '/api/metrics/query_range' ? { series: [] } : { traces: [] };
    }) as ProxyGet;
    const findings = [base, { ...base, observed: 'telemetry.auto.version', scope: 'resources' as const }];

    const evidence = await lookupFindingLibraries(findings, () => 'tempo', window, { get, limit: createLimiter(2) });

    expect(evidence.size).toBe(2);
    expect(queries.filter((query) => query.includes('{ } | count_over_time()'))).toHaveLength(1);
    expect(queries.some((query) => query.includes('resource.telemetry.auto.version != nil'))).toBe(true);
  });
});
