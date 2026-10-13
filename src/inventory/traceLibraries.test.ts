import fs from 'fs';
import path from 'path';
import { ProxyGet } from '../datasources/proxy';
import { createLimiter } from '../datasources/limiter';
import { flaggedKeyFilter, lookupLibraries, probeTraceQLMetrics } from './traceLibraries';
import { attributeSelector } from './traceql';

const fixtures = path.resolve(__dirname, '../../testdata/fixtures/local/tempo');
const readFixture = (name: string) => JSON.parse(fs.readFileSync(path.join(fixtures, name), 'utf8'));
const window = { startSeconds: 0, endSeconds: 24 * 3600 };
const flagged = { serviceName: 'checkout', key: 'http.method', scope: 'span' as const };

function fakeTempo(metricsError?: unknown) {
  const calls: Array<{ path: string; params: Record<string, string> }> = [];
  const get = (async (_uid: string, requestPath: string, params: Record<string, string>) => {
    calls.push({ path: requestPath, params });
    if (requestPath === '/api/metrics/query_range') {
      if (metricsError) {
        throw metricsError;
      }
      return readFixture('metrics-flagged-key.json');
    }
    return readFixture('search-flagged-key.json');
  }) as ProxyGet;
  return { context: { uid: 'tempo', get, limit: createLimiter(2), window }, calls };
}

describe('lookupLibraries', () => {
  it('uses TraceQL metrics with high confidence when available', async () => {
    const { context, calls } = fakeTempo();

    const evidence = await lookupLibraries(context, flagged, true);

    expect(evidence).toMatchObject({ method: 'metrics', confidence: 'high', libraries: [{ name: 'semconv.emitter.http', version: '0.1.0' }] });
    expect(evidence.libraries[0].spans).toBeGreaterThan(0);
    expect(evidence.firstSeenMs).toBeLessThanOrEqual(evidence.lastSeenMs ?? 0);
    expect(calls[0].params.q).toBe(
      '{ resource.service.name = "checkout" && span.http.method != nil } | count_over_time() by (instrumentation:name, instrumentation:version)'
    );
    expect(calls[0].params.step).toBe('4320s');
  });

  it('samples spans with medium confidence without TraceQL metrics', async () => {
    const { context, calls } = fakeTempo();

    const evidence = await lookupLibraries(context, flagged, false);

    expect(evidence).toMatchObject({ method: 'sample', confidence: 'medium', libraries: [{ name: 'semconv.emitter.http', version: '0.1.0', spans: 5 }] });
    expect(evidence.firstSeenMs).toBeDefined();
    expect(calls[0]).toMatchObject({ path: '/api/search', params: { limit: '20', spss: '3', start: '0', end: '86400' } });
  });

  it('falls back to a sample when TraceQL metrics return no series', async () => {
    const { context } = fakeTempo();
    const get = context.get;
    context.get = (async (uid: string, requestPath: string, params: Record<string, string>) =>
      requestPath === '/api/metrics/query_range' ? { series: [] } : get(uid, requestPath, params)) as typeof get;

    expect(await lookupLibraries(context, flagged, true)).toMatchObject({ method: 'sample', libraries: [{ spans: 5 }] });
  });

  it('falls back to a sample when a metrics query fails', async () => {
    const { context } = fakeTempo({ status: 400, data: { message: 'empty ring' } });

    expect((await lookupLibraries(context, flagged, true)).method).toBe('sample');
  });
});

describe('probeTraceQLMetrics', () => {
  it.each([
    [undefined, true],
    [{ status: 500, data: { message: 'empty ring' } }, false],
  ])('error %p gives %p', async (error, expected) => {
    expect(await probeTraceQLMetrics(fakeTempo(error).context)).toBe(expected);
  });
});

describe('selectors', () => {
  it.each([
    ['span', 'http.method', 'span.http.method'],
    ['resource', 'service.name', 'resource.service.name'],
    ['span', 'http.request.header.x-trace', 'span."http.request.header.x-trace"'],
    ['span', 'we"ird', 'span."we\\"ird"'],
  ] as const)('%s %s', (scope, key, expected) => {
    expect(attributeSelector(scope, key)).toBe(expected);
  });

  it('combines the service and key filters', () => {
    expect(flaggedKeyFilter({ serviceName: '', key: 'net.peer.name', scope: 'span' })).toBe('{ resource.service.name = "" && span.net.peer.name != nil }');
  });
});
