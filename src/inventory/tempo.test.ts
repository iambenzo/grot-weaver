import fs from 'fs';
import path from 'path';
import { ProxyGet } from '../datasources/proxy';
import { createLimiter } from '../datasources/limiter';
import { collectTempoInventory, serviceFilter } from './tempo';
import { SpanGroupRule } from '../api/catalogue';
import { MAX_TRACE_SERVICES } from './limits';

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
            labels: [
              { key: 'resource.service.name', value: { stringValue: 'checkout' } },
              { key: 'resource.service.namespace', value: { stringValue: 'shop' } },
              { key: 'resource.telemetry.sdk.language', value: { stringValue: 'python' } },
              { key: 'resource.telemetry.distro.name', value: { stringValue: 'nil' } },
            ],
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

  it('splits a service name used in several namespaces into one service per namespace', async () => {
    const calls: Call[] = [];
    const get = (async (_uid: string, requestPath: string, params: Record<string, string>) => {
      calls.push({ path: requestPath, params });
      if (requestPath === '/api/v2/search/tag/resource.service.name/values') {
        return { tagValues: [{ type: 'string', value: 'api' }] };
      }
      if (requestPath.includes('service.namespace')) {
        return {
          tagValues: [
            { type: 'string', value: 'shop' },
            { type: 'string', value: 'billing' },
          ],
        };
      }
      if (requestPath === '/api/metrics/query_range') {
        const series = (namespace: string, spans: number) => ({
          labels: [
            { key: 'resource.service.name', value: { stringValue: 'api' } },
            { key: 'resource.service.namespace', value: { stringValue: namespace } },
          ],
          samples: [{ timestampMs: '1', value: spans }],
        });
        return { series: [series('shop', 7), series('billing', 5)] };
      }
      if (requestPath === '/api/v2/search/tags') {
        if (!params.q || params.q.includes('semconv-compliance-filter-probe')) {
          return { scopes: [] };
        }
        return { scopes: [{ name: params.scope, tags: [params.q.includes('shop') ? 'http.route' : 'rpc.method'] }] };
      }
      return { tagValues: [] };
    }) as ProxyGet;

    const { datasource, errors } = await collectTempoInventory('tempo', get, createLimiter(2), window);

    expect(errors).toEqual([]);
    expect(
      datasource.services.map((service) => ({
        namespace: service.service_namespace,
        spans: service.span_count,
        keys: service.span_keys.map((key) => key.key),
      }))
    ).toEqual([
      { namespace: 'shop', spans: 7, keys: ['http.route'] },
      { namespace: 'billing', spans: 5, keys: ['rpc.method'] },
    ]);
    expect(
      calls.some(
        (call) => call.params.q === '{ resource.service.name = "api" && resource.service.namespace = "billing" }'
      )
    ).toBe(true);
  });

  it('splits off spans without a namespace, filtering them with nil', async () => {
    const { get, calls } = fakeTempo();
    const volumes = (async (uid: string, requestPath: string, params: Record<string, string>) =>
      requestPath === '/api/metrics/query_range'
        ? {
            series: ['shop', undefined].map((namespace) => ({
              labels: [
                { key: 'resource.service.name', value: { stringValue: 'checkout' } },
                ...(namespace ? [{ key: 'resource.service.namespace', value: { stringValue: namespace } }] : []),
              ],
              samples: [{ timestampMs: '1', value: 10 }],
            })),
          }
        : get(uid, requestPath, params)) as ProxyGet;

    const { datasource } = await collectTempoInventory('tempo', volumes, createLimiter(2), window);

    const checkout = datasource.services.filter((service) => service.service_name === 'checkout');
    expect(checkout.map((service) => [service.service_namespace, service.span_count])).toEqual([
      ['shop', 10],
      ['', 10],
    ]);
    expect(
      calls.some(
        (call) => call.params.q === '{ resource.service.name = "checkout" && resource.service.namespace = nil }'
      )
    ).toBe(true);
  });

  it('probes for spans without a namespace when TraceQL metrics are unavailable', async () => {
    const { get, calls } = fakeTempo(['/api/metrics/query_range']);
    const probing = (async (uid: string, requestPath: string, params: Record<string, string>) =>
      requestPath === '/api/search' && params.limit === '1'
        ? { traces: params.q.includes('checkout') ? [{ traceID: 't' }] : [] }
        : requestPath === '/api/search'
          ? { traces: [] }
          : get(uid, requestPath, params)) as ProxyGet;

    const { datasource } = await collectTempoInventory('tempo', probing, createLimiter(2), window);

    const checkout = datasource.services.filter((service) => service.service_name === 'checkout');
    expect(checkout.map((service) => service.service_namespace)).toEqual(['shop', '']);
    expect(calls.filter((call) => call.path.includes('service.namespace')).length).toBe(6);
  });

  it('does not split on namespaces when Tempo ignores the tag filter', async () => {
    const { get } = fakeTempo(['/api/metrics/query_range']);
    const ignoring = (async (uid: string, requestPath: string, params: Record<string, string>) => {
      if (requestPath === '/api/v2/search/tags') {
        return { scopes: [{ name: 'span', tags: ['a'] }] };
      }
      if (requestPath.includes('service.namespace')) {
        return { tagValues: [{ value: 'shop' }, { value: 'billing' }] };
      }
      if (requestPath === '/api/search') {
        return { traces: [] };
      }
      return get(uid, requestPath, params);
    }) as ProxyGet;

    const { datasource } = await collectTempoInventory('tempo', ignoring, createLimiter(2), window);

    expect(datasource.services.filter((service) => service.service_name === 'checkout')).toHaveLength(1);
  });

  it('adds namespaces that tag values know about but the metrics result missed, with a sampled volume', async () => {
    const { get } = fakeTempo();
    const merged = (async (uid: string, requestPath: string, params: Record<string, string>) =>
      requestPath.includes('service.namespace')
        ? { tagValues: params.q.includes('checkout') ? [{ value: 'shop' }, { value: 'billing' }] : [] }
        : requestPath === '/api/search'
          ? { traces: params.q.includes('"billing"') ? [{ spanSets: [{ matched: 4 }] }] : [] }
          : get(uid, requestPath, params)) as ProxyGet;

    const { datasource } = await collectTempoInventory('tempo', merged, createLimiter(2), window);

    const checkout = datasource.services.filter((service) => service.service_name === 'checkout');
    expect(checkout.map((service) => [service.service_namespace, service.span_count])).toEqual([
      ['shop', 42],
      ['billing', 4],
    ]);
  });

  it('takes the namespace from the trace sample when Tempo ignores the tag filter', async () => {
    const { get } = fakeTempo(['/api/metrics/query_range']);
    const sampling = (async (uid: string, requestPath: string, params: Record<string, string>) => {
      if (requestPath === '/api/v2/search/tags') {
        return { scopes: [{ name: 'span', tags: ['a'] }] };
      }
      if (requestPath === '/api/search') {
        return { traces: params.q?.includes('checkout') ? [{ traceID: 't' }] : [] };
      }
      if (requestPath.startsWith('/api/v2/traces/')) {
        return {
          trace: {
            resourceSpans: [
              {
                resource: {
                  attributes: [
                    { key: 'service.name', value: { stringValue: 'checkout' } },
                    { key: 'service.namespace', value: { stringValue: 'shop' } },
                  ],
                },
                scopeSpans: [],
              },
            ],
          },
        };
      }
      return get(uid, requestPath, params);
    }) as ProxyGet;

    const { datasource } = await collectTempoInventory('tempo', sampling, createLimiter(2), window);

    expect(datasource.services.find((service) => service.service_name === 'checkout')?.service_namespace).toBe('shop');
    expect(datasource.services.find((service) => service.service_name === 'inventory')?.service_namespace).toBe('');
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
    expect(errors.length).toBe(4);
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

  it('reports mixed volumes when TraceQL metrics miss some services', async () => {
    const { get } = fakeTempo();

    expect((await collectTempoInventory('tempo', get, createLimiter(2), window)).volumeMethod).toBe('mixed');
  });

  it('reports metrics as the volume method when TraceQL metrics cover every service', async () => {
    const { get } = fakeTempo();
    const onlyCheckout = (async (uid: string, requestPath: string, params: Record<string, string>) =>
      requestPath === '/api/v2/search/tag/resource.service.name/values'
        ? { tagValues: [{ type: 'string', value: 'checkout' }] }
        : get(uid, requestPath, params)) as ProxyGet;

    expect((await collectTempoInventory('tempo', onlyCheckout, createLimiter(2), window)).volumeMethod).toBe('metrics');
  });

  it('reports a distro only when it covers most of the service spans', async () => {
    const { get } = fakeTempo();
    const distroSeries = (distro: string | undefined, spans: number) => ({
      labels: [
        { key: 'resource.service.name', value: { stringValue: 'checkout' } },
        { key: 'resource.service.namespace', value: { stringValue: 'shop' } },
        ...(distro ? [{ key: 'resource.telemetry.distro.name', value: { stringValue: distro } }] : []),
      ],
      samples: [{ timestampMs: '1', value: spans }],
    });
    const withDistros = (rare: number, common: number, distroFirst: boolean, other?: string) =>
      (async (uid: string, requestPath: string, params: Record<string, string>) => {
        if (requestPath !== '/api/metrics/query_range' || !params.q.includes('telemetry.distro.name')) {
          return get(uid, requestPath, params);
        }
        const series = [distroSeries(other, common), distroSeries('beyla', rare)];
        return { series: distroFirst ? series.reverse() : series };
      }) as ProxyGet;
    const checkoutSdk = async (rare: number, common: number, distroFirst = false, other?: string) =>
      (
        await collectTempoInventory('tempo', withDistros(rare, common, distroFirst, other), createLimiter(2), window)
      ).datasource.services.find((service) => service.service_name === 'checkout')?.sdk;

    expect(await checkoutSdk(1, 100)).toEqual({ language: 'python' });
    expect(await checkoutSdk(100, 1)).toEqual({ language: 'python', distro: 'beyla' });
    expect(await checkoutSdk(10, 10)).toEqual({ language: 'python' });
    expect(await checkoutSdk(10, 10, true)).toEqual({ language: 'python' });
    expect(await checkoutSdk(10, 10, false, 'odigos')).toEqual({ language: 'python' });
    expect(await checkoutSdk(10, 10, true, 'odigos')).toEqual({ language: 'python' });
  });

  it('takes SDK fields for every service from two TraceQL metrics queries instead of per-service tag values', async () => {
    const { get, calls } = fakeTempo();

    const { datasource } = await collectTempoInventory('tempo', get, createLimiter(2), window);

    const checkout = datasource.services.find((service) => service.service_name === 'checkout');
    expect(checkout?.sdk).toEqual({ language: 'python' });
    const checkoutSdkTagCalls = calls.filter(
      (call) => call.path.includes('telemetry') && call.params.q?.includes('"checkout"')
    );
    expect(checkoutSdkTagCalls).toEqual([]);
    const metricQueries = calls.filter((call) => call.path === '/api/metrics/query_range').map((call) => call.params.q);
    expect(metricQueries).toEqual([
      '{ } | count_over_time() by (resource.service.name, resource.service.namespace, resource.telemetry.sdk.name, resource.telemetry.sdk.language, resource.telemetry.sdk.version)',
      '{ } | count_over_time() by (resource.service.name, resource.service.namespace, resource.telemetry.distro.name)',
    ]);
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
    expect(serviceFilter({ name })).toBe(expected);
  });

  it('adds the namespace when there is one', () => {
    expect(serviceFilter({ name: 'checkout', namespace: 'sh"op' })).toBe(
      '{ resource.service.name = "checkout" && resource.service.namespace = "sh\\"op" }'
    );
  });
});

describe('scorer limits', () => {
  it('skips a Tempo datasource with more services than the scorer accepts', async () => {
    const { get, calls } = fakeTempo();
    const many = (async (uid: string, requestPath: string, params: Record<string, string>) =>
      requestPath === '/api/v2/search/tag/resource.service.name/values'
        ? { tagValues: Array.from({ length: MAX_TRACE_SERVICES + 1 }, (_, index) => ({ value: `svc-${index}` })) }
        : get(uid, requestPath, params)) as ProxyGet;

    const { datasource, errors } = await collectTempoInventory('tempo', many, createLimiter(2), window);

    expect(datasource.services).toEqual([]);
    expect(calls.some((call) => call.path === '/api/v2/search/tags' && call.params.q?.includes('svc-'))).toBe(false);
    expect(errors.map((error) => error.message)).toContain(
      `${MAX_TRACE_SERVICES + 1} found, over the ${MAX_TRACE_SERVICES} the scorer accepts, so this datasource was not scanned`
    );
  });
});

describe('unknown parts', () => {
  const unknownOf = (services: Array<{ service_name: string; unknown?: string[] }>, name: string) =>
    services.find((service) => service.service_name === name)?.unknown ?? [];

  it('marks the namespace unknown when its lookup fails for a service TraceQL metrics did not cover', async () => {
    const { get } = fakeTempo(['service.namespace']);

    const { datasource } = await collectTempoInventory('tempo', get, createLimiter(2), window);

    expect(unknownOf(datasource.services, 'checkout')).not.toContain('service_namespace');
    expect(unknownOf(datasource.services, 'inventory')).toContain('service_namespace');
  });

  it('marks resource keys unknown when the resource tag lookup fails', async () => {
    const { get } = fakeTempo();
    const failing = (async (uid: string, requestPath: string, params: Record<string, string>) => {
      if (requestPath === '/api/v2/search/tags' && params.scope === 'resource' && params.q?.includes('"checkout"')) {
        throw { status: 500, data: { message: 'tempo exploded' } };
      }
      return get(uid, requestPath, params);
    }) as ProxyGet;

    const { datasource } = await collectTempoInventory('tempo', failing, createLimiter(2), window);

    expect(unknownOf(datasource.services, 'checkout')).toEqual(['resource_keys']);
  });

  it('marks volume unknown when the sampled volume search fails', async () => {
    const { get } = fakeTempo(['/api/metrics/query_range', '/api/search']);

    const { datasource } = await collectTempoInventory('tempo', get, createLimiter(2), window);

    expect(datasource.services.every((service) => service.unknown?.includes('volume'))).toBe(true);
    expect(datasource.services.every((service) => service.span_count === 0)).toBe(true);
  });
});

describe('request cost', () => {
  it('makes three requests per service plus five stack-wide ones when TraceQL metrics answer', async () => {
    const names = Array.from({ length: 50 }, (_, index) => `svc-${index}`);
    const calls: Call[] = [];
    const get = (async (_uid: string, requestPath: string, params: Record<string, string>) => {
      calls.push({ path: requestPath, params });
      if (requestPath === '/api/v2/search/tag/resource.service.name/values') {
        return { tagValues: names.map((value) => ({ value })) };
      }
      if (requestPath === '/api/metrics/query_range') {
        return {
          series: names.map((name) => ({
            labels: [
              { key: 'resource.service.name', value: { stringValue: name } },
              { key: 'resource.service.namespace', value: { stringValue: 'shop' } },
            ],
            samples: [{ timestampMs: '1', value: 1 }],
          })),
        };
      }
      if (requestPath === '/api/v2/search/tags') {
        return { scopes: params.q?.includes('svc-') ? [{ name: params.scope, tags: ['a'] }] : [] };
      }
      return { tagValues: [{ value: 'shop' }] };
    }) as ProxyGet;

    const { datasource, errors } = await collectTempoInventory('tempo', get, createLimiter(8), window);

    expect(errors).toEqual([]);
    expect(datasource.services).toHaveLength(names.length);
    for (const name of names) {
      expect(calls.filter((call) => call.params.q?.includes(`"${name}"`))).toHaveLength(3);
    }
    expect(calls).toHaveLength(5 + 3 * names.length);
  });
});
