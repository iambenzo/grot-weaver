import { ProxyGet } from '../datasources/proxy';
import { createLimiter } from '../datasources/limiter';
import { isTagFilterIgnored, sampleServiceKeys } from './traceKeys';

const window = { startSeconds: 0, endSeconds: 3600 };
const allTags = { scopes: [{ name: 'span', tags: ['http.method', 'net.peer.name', 'rpc.system'] }] };

function context(get: ProxyGet, sampleLimit?: number) {
  return { uid: 'tempo', get, limit: createLimiter(2), window, sampleLimit };
}

describe('isTagFilterIgnored', () => {
  it.each([
    ['returns everything for a service that cannot exist', allTags, true],
    ['returns a few leaked tags for the probe', { scopes: [{ name: 'span', tags: ['http.method'] }] }, false],
    ['returns nothing for the probe', { scopes: [] }, false],
  ])('when Tempo %s', async (_label, probeResponse, expected) => {
    const get = (async (_uid: string, _path: string, params: Record<string, string>) =>
      params.q ? probeResponse : allTags) as ProxyGet;

    expect(await isTagFilterIgnored(context(get))).toBe(expected);
  });

  it('is not ignored when Tempo has no tags at all', async () => {
    const get = (async () => ({ scopes: [] })) as ProxyGet;

    expect(await isTagFilterIgnored(context(get))).toBe(false);
  });
});

describe('sampleServiceKeys', () => {
  it('unions keys from the service own resource spans only, within the trace limit', async () => {
    const calls: Array<{ path: string; params: Record<string, string> }> = [];
    const get = (async (_uid: string, requestPath: string, params: Record<string, string>) => {
      calls.push({ path: requestPath, params });
      if (requestPath === '/api/search') {
        return { traces: [{ traceID: 't1' }, { traceID: 't2' }] };
      }
      const service = (name: string, keys: string[]) => ({
        resource: { attributes: [{ key: 'service.name', value: { stringValue: name } }] },
        scopeSpans: [{ spans: keys.map((key) => ({ attributes: [{ key }] })) }],
      });
      return requestPath.endsWith('t1')
        ? { trace: { resourceSpans: [service('flagd', ['net.peer.name']), service('frontend', ['http.method'])] } }
        : { batches: [service('flagd', ['rpc.system', 'net.peer.port'])] };
    }) as ProxyGet;

    const keys = await sampleServiceKeys(context(get, 3), { name: 'flagd' }, '{ resource.service.name = "flagd" }');

    expect(keys).toEqual({ resource: ['service.name'], span: ['net.peer.name', 'net.peer.port', 'rpc.system'] });
    expect(calls[0]).toMatchObject({
      path: '/api/search',
      params: { limit: '3', q: '{ resource.service.name = "flagd" }' },
    });
    expect(calls.slice(1).map((call) => call.path)).toEqual(['/api/v2/traces/t1', '/api/v2/traces/t2']);
  });

  it('keeps only resource spans from the requested namespace', async () => {
    const service = (namespace: string, key: string) => ({
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: 'api' } },
          { key: 'service.namespace', value: { stringValue: namespace } },
        ],
      },
      scopeSpans: [{ spans: [{ attributes: [{ key }] }] }],
    });
    const get = (async (_uid: string, requestPath: string) =>
      requestPath === '/api/search'
        ? { traces: [{ traceID: 't' }] }
        : { trace: { resourceSpans: [service('shop', 'http.route'), service('billing', 'rpc.method')] } }) as ProxyGet;

    expect((await sampleServiceKeys(context(get), { name: 'api', namespace: 'shop' }, '{ }')).span).toEqual([
      'http.route',
    ]);
  });

  it('matches spans without a service name to the nameless service', async () => {
    const get = (async (_uid: string, requestPath: string) =>
      requestPath === '/api/search'
        ? { traces: [{ traceID: 't' }] }
        : {
            trace: {
              resourceSpans: [
                { resource: { attributes: [] }, scopeSpans: [{ spans: [{ attributes: [{ key: 'a' }] }] }] },
              ],
            },
          }) as ProxyGet;

    expect((await sampleServiceKeys(context(get), { name: '' }, '{ }')).span).toEqual(['a']);
  });
});
