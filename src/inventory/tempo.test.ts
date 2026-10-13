import fs from 'fs';
import path from 'path';
import { ProxyGet } from '../datasources/proxy';
import { createLimiter } from '../datasources/limiter';
import { collectTempoInventory, serviceFilter } from './tempo';
import { SpanGroupRule } from '../api/catalogue';

const fixtures = path.resolve(__dirname, '../../testdata/fixtures/local/tempo');
const readFixture = (name: string) => JSON.parse(fs.readFileSync(path.join(fixtures, name), 'utf8'));
const window = { startSeconds: 100, endSeconds: 200 };

interface Call {
  path: string;
  params: Record<string, string>;
}

function fakeTempo(failPaths: string[] = []): { get: ProxyGet; calls: Call[] } {
  const calls: Call[] = [];
  const get = (async (_uid: string, requestPath: string, params: Record<string, string>) => {
    calls.push({ path: requestPath, params });
    if (failPaths.some((failing) => requestPath.includes(failing))) {
      throw { status: 500, data: { message: 'tempo exploded' } };
    }
    if (requestPath === '/api/v2/search/tag/resource.service.name/values') {
      return readFixture('service-names.json');
    }
    if (requestPath === '/api/v2/search/tags') {
      if (params.q?.includes('semconv-compliance-filter-probe')) {
        return { scopes: [] };
      }
      return readFixture(params.scope === 'resource' ? 'tags-resource.json' : 'tags-span.json');
    }
    if (requestPath === '/api/metrics/query_range') {
      return {
        series: [
          {
            labels: [{ key: 'resource.service.name', value: { stringValue: 'checkout' } }],
            samples: [
              { timestampMs: '1', value: 30 },
              { timestampMs: '2', value: 12 },
            ],
          },
          {
            labels: [{ key: 'resource.service.name', value: { stringValue: '' } }],
            samples: [{ timestampMs: '1', value: 3 }],
          },
        ],
      };
    }
    if (requestPath.includes('service.namespace')) {
      return { tagValues: params.q.includes('checkout') ? [{ type: 'string', value: 'shop' }] : [] };
    }
    if (requestPath.includes('telemetry.sdk.language')) {
      return { tagValues: [{ type: 'string', value: 'python' }] };
    }
    return { tagValues: [] };
  }) as ProxyGet;
  return { get, calls };
}

describe('collectTempoInventory', () => {
  it('collects every service from the window, including the one without a name', async () => {
    const { get, calls } = fakeTempo();

    const { datasource, errors } = await collectTempoInventory('tempo', get, createLimiter(2), window);

    expect(errors).toEqual([]);
    expect(datasource.services.map((service) => service.service_name).sort()).toEqual(
      ['', 'checkout', 'inventory', 'payments', 'unknown_service:python', 'zipkin-svc'].sort()
    );
    const checkout = datasource.services.find((service) => service.service_name === 'checkout');
    expect(checkout?.service_namespace).toBe('shop');
    expect(checkout?.span_count).toBe(42);
    expect(datasource.services.find((service) => service.service_name === '')?.span_count).toBe(3);
    expect(checkout?.sdk).toEqual({ language: 'python' });
    expect(checkout?.span_keys.map((key) => key.key)).toContain('http.method');
    expect(checkout?.resource_keys.map((key) => key.key)).toContain('service.name');
    expect(calls.every((call) => call.params.start === '100' && call.params.end === '200')).toBe(true);
  });

  it('filters per service with q and scope', async () => {
    const { get, calls } = fakeTempo();

    await collectTempoInventory('tempo', get, createLimiter(2), window);

    const tagCalls = calls.filter((call) => call.path === '/api/v2/search/tags');
    expect(tagCalls).toContainEqual({
      path: '/api/v2/search/tags',
      params: { start: '100', end: '200', scope: 'span', q: '{ resource.service.name = "checkout" }' },
    });
    expect(tagCalls.some((call) => call.params.q === '{ resource.service.name = "" }')).toBe(true);
  });

  it('adds span group samples to each service', async () => {
    const { get } = fakeTempo();
    const rule: SpanGroupRule = {
      id: 'span.http.server',
      span_kind: 'server',
      identifying: 'http.request.method',
      required: ['http.request.method'],
      recommended: [],
      stability: 'stable',
    };
    const sampling = (async (uid: string, requestPath: string, params: Record<string, string>) =>
      requestPath === '/api/search'
        ? { traces: [{ spanSets: [{ spans: [{ attributes: [{ key: 'http.request.method' }] }] }] }] }
        : get(uid, requestPath, params)) as ProxyGet;

    const { datasource } = await collectTempoInventory('tempo', sampling, createLimiter(2), window, [rule]);

    const checkout = datasource.services.find((service) => service.service_name === 'checkout');
    expect(checkout?.span_groups).toEqual([
      { group: 'span.http.server', sampled: 1, present: { 'http.request.method': 1 } },
    ]);
  });

  it('records a failing step and keeps the rest', async () => {
    const { get } = fakeTempo(['telemetry.sdk.language']);

    const { datasource, errors } = await collectTempoInventory('tempo', get, createLimiter(2), window);

    expect(datasource.services.length).toBe(6);
    expect(errors.length).toBe(6);
    expect(errors[0]).toMatchObject({ datasource: 'tempo', message: 'tempo exploded' });
  });

  it('counts span volume from a sample when TraceQL metrics are unavailable', async () => {
    const { get } = fakeTempo(['/api/metrics/query_range']);
    const sampling = (async (uid: string, requestPath: string, params: Record<string, string>) =>
      requestPath === '/api/search'
        ? { traces: [{ spanSets: [{ matched: params.q.includes('checkout') ? 4 : 1 }, { matched: 2 }] }] }
        : get(uid, requestPath, params)) as ProxyGet;

    const collection = await collectTempoInventory('tempo', sampling, createLimiter(2), window, [], 7);

    expect(collection.volumeMethod).toBe('sample');
    expect(collection.errors).toEqual([]);
    const checkout = collection.datasource.services.find((service) => service.service_name === 'checkout');
    expect(checkout?.span_count).toBe(6);
  });

  it('reports metrics as the volume method when TraceQL metrics answer', async () => {
    const { get } = fakeTempo();

    expect((await collectTempoInventory('tempo', get, createLimiter(2), window)).volumeMethod).toBe('metrics');
  });

  it('samples keys from traces when the tag filter is ignored', async () => {
    const { get } = fakeTempo();
    const otlp = (service: string, spanKey: string) => ({
      resource: { attributes: [{ key: 'service.name', value: { stringValue: service } }, { key: 'k8s.pod.name' }] },
      scopeSpans: [{ spans: [{ attributes: [{ key: spanKey }] }] }],
    });
    const ignoring = (async (uid: string, requestPath: string, params: Record<string, string>) => {
      if (requestPath === '/api/v2/search/tags') {
        return readFixture(params.scope === 'resource' ? 'tags-resource.json' : 'tags-span.json');
      }
      if (requestPath === '/api/search' && !params.spss) {
        return { traces: [{ traceID: 'abc' }] };
      }
      if (requestPath === '/api/v2/traces/abc') {
        return {
          trace: { resourceSpans: [otlp('checkout', 'http.request.method'), otlp('payments', 'net.peer.name')] },
        };
      }
      return get(uid, requestPath, params);
    }) as ProxyGet;

    const collection = await collectTempoInventory('tempo', ignoring, createLimiter(2), window);

    expect(collection.keysMethod).toBe('sample');
    const checkout = collection.datasource.services.find((service) => service.service_name === 'checkout');
    expect(checkout?.span_keys.map((key) => key.key)).toEqual(['http.request.method']);
    expect(checkout?.resource_keys.map((key) => key.key)).toEqual(['k8s.pod.name', 'service.name']);
  });

  it('uses tag search when the filter is honoured', async () => {
    const { get } = fakeTempo();

    expect((await collectTempoInventory('tempo', get, createLimiter(2), window)).keysMethod).toBe('tags');
  });

  it('returns an empty datasource when service discovery fails', async () => {
    const { get } = fakeTempo(['resource.service.name/values', '/api/metrics/query_range']);

    const collection = await collectTempoInventory('tempo', get, createLimiter(2), window);

    expect(collection.datasource).toEqual({ uid: 'tempo', services: [] });
    expect(collection.errors).toHaveLength(1);
    expect(collection.volumeMethod).toBeUndefined();
  });
});

describe('serviceFilter', () => {
  it.each([
    ['checkout', '{ resource.service.name = "checkout" }'],
    ['', '{ resource.service.name = "" }'],
    ['we"ird\\name', '{ resource.service.name = "we\\"ird\\\\name" }'],
  ])('escapes %p', (name, expected) => {
    expect(serviceFilter(name)).toBe(expected);
  });
});
