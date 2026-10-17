import fs from 'fs';
import path from 'path';
import { ProxyGet } from '../datasources/proxy';
import { createLimiter } from '../datasources/limiter';
import { collectLokiInventory, streamSelector } from './loki';
import { MAX_LOG_SERVICES } from './limits';

const fixture = (name: string) =>
  JSON.parse(fs.readFileSync(path.resolve(__dirname, `../../testdata/fixtures/local/loki/${name}`), 'utf8'));
const window = { startSeconds: 100, endSeconds: 1900 };

interface FakeLokiOptions {
  detectedFieldsFail?: boolean;
  series?: Array<Record<string, string>>;
  volumes?: Array<{ metric: Record<string, string>; bytes: number }>;
  volumeFails?: boolean;
  statsFails?: boolean;
  seriesFails?: boolean;
  serviceNames?: string[];
}

function fakeLoki(options: FakeLokiOptions = {}) {
  const calls: Array<{ path: string; params: Record<string, string>; headers?: Record<string, string> }> = [];
  const get = (async (
    _uid: string,
    requestPath: string,
    params: Record<string, string>,
    headers?: Record<string, string>
  ) => {
    calls.push({ path: requestPath, params, headers });
    switch (requestPath) {
      case '/loki/api/v1/labels':
        return fixture('labels.json');
      case '/loki/api/v1/label/service_name/values':
        return { status: 'success', data: options.serviceNames ?? ['checkout'] };
      case '/loki/api/v1/series':
        if (options.seriesFails) {
          throw { status: 500, data: 'loki exploded' };
        }
        return options.series ? { status: 'success', data: options.series } : fixture('series-checkout.json');
      case '/loki/api/v1/detected_fields':
        if (options.detectedFieldsFail) {
          throw { status: 404, data: { message: 'not found' } };
        }
        return fixture('detected-fields-checkout.json');
      case '/loki/api/v1/query_range':
        return fixture('sample-checkout.json');
      case '/loki/api/v1/index/volume':
        if (options.volumeFails) {
          throw { status: 404, data: 'volume disabled' };
        }
        return {
          status: 'success',
          data: {
            result: (
              options.volumes ?? [{ metric: { service_name: 'checkout', service_namespace: 'shop' }, bytes: 80 }]
            ).map(({ metric, bytes }) => ({ metric, value: [0, String(bytes)] })),
          },
        };
      case '/loki/api/v1/index/stats':
        if (options.statsFails) {
          throw { status: 500, data: 'loki exploded' };
        }
        return { streams: 1, chunks: 1, entries: 1, bytes: 7 };
    }
    throw new Error(`unexpected ${requestPath}`);
  }) as ProxyGet;
  return { get, calls };
}

describe('collectLokiInventory', () => {
  it('uses detected fields for keys and a small sample for SDK and scope values', async () => {
    const { get, calls } = fakeLoki();

    const { datasource, errors } = await collectLokiInventory('loki', get, createLimiter(4), window);

    expect(errors).toEqual([]);
    const checkout = datasource.services[0];
    expect(checkout).toMatchObject({
      service_name: 'checkout',
      service_namespace: 'shop',
      keys_method: 'detected_fields',
      scope_names: ['semconv.emitter.logs'],
      sdk: { name: 'opentelemetry', language: 'python', version: '1.45.1' },
      volume: 80,
    });
    expect(checkout.metadata_keys).toEqual(
      expect.arrayContaining(['http_method', 'http_request_method', 'trace_id', 'scope_name'])
    );
    expect(checkout.stream_labels).toEqual([
      'deployment_environment_name',
      'service_instance_id',
      'service_name',
      'service_namespace',
    ]);
    expect(checkout.otlp_markers).toEqual(
      expect.arrayContaining(['scope_name', 'severity_number', 'observed_timestamp', 'flags', 'telemetry_sdk_name'])
    );

    const sampleCall = calls.find((call) => call.path === '/loki/api/v1/query_range');
    expect(sampleCall?.params).toMatchObject({
      query: '{service_name="checkout"}',
      limit: '5',
      start: '100000000000',
      end: '1900000000000',
    });
    expect(sampleCall?.headers).toEqual({ 'X-Loki-Response-Encoding-Flags': 'categorize-labels' });
  });

  it('splits a service name used in several namespaces, including streams without one', async () => {
    const { get, calls } = fakeLoki({
      series: [
        { service_name: 'checkout', service_namespace: 'shop', env: 'prod' },
        { service_name: 'checkout', service_namespace: 'billing' },
        { service_name: 'checkout' },
      ],
    });

    const { datasource, errors } = await collectLokiInventory('loki', get, createLimiter(4), window);

    expect(errors).toEqual([]);
    expect(datasource.services.map((service) => [service.service_namespace, service.stream_labels])).toEqual([
      ['shop', ['env', 'service_name', 'service_namespace']],
      ['billing', ['service_name', 'service_namespace']],
      ['', ['service_name']],
    ]);
    expect(
      calls.filter((call) => call.path === '/loki/api/v1/detected_fields').map((call) => call.params.query)
    ).toEqual([
      '{service_name="checkout", service_namespace="shop"}',
      '{service_name="checkout", service_namespace="billing"}',
      '{service_name="checkout", service_namespace=""}',
    ]);
  });

  it('takes every service volume from one index volume call', async () => {
    const { get, calls } = fakeLoki();

    await collectLokiInventory('loki', get, createLimiter(4), window);

    const volumeCalls = calls.filter((call) => call.path.startsWith('/loki/api/v1/index/'));
    expect(volumeCalls).toEqual([
      {
        path: '/loki/api/v1/index/volume',
        params: {
          query: '{service_name=~".+", service_namespace=~".*"}',
          limit: '5000',
          start: '100000000000',
          end: '1900000000000',
        },
        headers: undefined,
      },
    ]);
    expect(calls.some((call) => call.path === '/loki/api/v1/query')).toBe(false);
  });

  it('gives each namespace of a split service its own volume', async () => {
    const { get } = fakeLoki({
      series: [{ service_name: 'checkout', service_namespace: 'shop' }, { service_name: 'checkout' }],
      volumes: [
        { metric: { service_name: 'checkout', service_namespace: 'shop' }, bytes: 30 },
        { metric: { service_name: 'checkout' }, bytes: 12 },
      ],
    });

    const { datasource } = await collectLokiInventory('loki', get, createLimiter(4), window);

    expect(datasource.services.map((service) => [service.service_namespace, service.volume])).toEqual([
      ['shop', 30],
      ['', 12],
    ]);
  });

  it('asks index stats for a service missing from the volume result', async () => {
    const { get, calls } = fakeLoki({ volumes: [] });

    const { datasource } = await collectLokiInventory('loki', get, createLimiter(4), window);

    expect(datasource.services[0].volume).toBe(7);
    expect(calls.find((call) => call.path === '/loki/api/v1/index/stats')?.params.query).toBe(
      '{service_name="checkout"}'
    );
  });

  it('falls back to index stats per service when the volume endpoint is unavailable', async () => {
    const { get } = fakeLoki({ volumeFails: true });

    const { datasource, errors } = await collectLokiInventory('loki', get, createLimiter(4), window);

    expect(errors).toEqual([]);
    expect(datasource.services[0].volume).toBe(7);
  });

  it('falls back to a larger sample for keys when detected fields are unavailable', async () => {
    const { get, calls } = fakeLoki({ detectedFieldsFail: true });

    const { datasource, errors } = await collectLokiInventory('loki', get, createLimiter(4), window);

    expect(errors).toEqual([]);
    expect(datasource.services[0].keys_method).toBe('sample');
    expect(datasource.services[0].metadata_keys).toEqual(expect.arrayContaining(['http_method', 'scope_name']));
    expect(
      calls
        .filter((call) => call.path === '/loki/api/v1/query_range')
        .map((call) => call.params.limit)
        .sort()
    ).toEqual(['20', '5']);
  });
});

describe('unknown parts', () => {
  it('marks stream labels and namespace unknown when the streams call fails and the index cannot help', async () => {
    const { get } = fakeLoki({ seriesFails: true, volumeFails: true });

    const { datasource } = await collectLokiInventory('loki', get, createLimiter(4), window);

    expect(datasource.services[0].unknown).toEqual(['stream_labels', 'service_namespace']);
  });

  it('splits by the index volume namespaces when the streams call fails, leaving only stream labels unknown', async () => {
    const { get, calls } = fakeLoki({
      seriesFails: true,
      volumes: [
        { metric: { service_name: 'checkout', service_namespace: 'shop' }, bytes: 30 },
        { metric: { service_name: 'checkout', service_namespace: 'billing' }, bytes: 12 },
      ],
    });

    const { datasource } = await collectLokiInventory('loki', get, createLimiter(4), window);

    expect(datasource.services.map((service) => [service.service_namespace, service.volume, service.unknown])).toEqual([
      ['shop', 30, ['stream_labels']],
      ['billing', 12, ['stream_labels']],
    ]);
    expect(
      calls.filter((call) => call.path === '/loki/api/v1/detected_fields').map((call) => call.params.query)
    ).toEqual([
      '{service_name="checkout", service_namespace="shop"}',
      '{service_name="checkout", service_namespace="billing"}',
    ]);
  });

  it('uses the index volume namespaces when the streams call answers with no streams', async () => {
    const { get } = fakeLoki({
      series: [],
      volumes: [
        { metric: { service_name: 'checkout', service_namespace: 'shop' }, bytes: 30 },
        { metric: { service_name: 'checkout', service_namespace: 'billing' }, bytes: 12 },
      ],
    });

    const { datasource } = await collectLokiInventory('loki', get, createLimiter(4), window);

    expect(datasource.services.map((service) => [service.service_namespace, service.unknown])).toEqual([
      ['shop', ['stream_labels']],
      ['billing', ['stream_labels']],
    ]);
  });

  it('marks stream labels and namespace unknown when there are no streams and no index entry', async () => {
    const { get } = fakeLoki({ series: [], volumes: [] });

    const { datasource } = await collectLokiInventory('loki', get, createLimiter(4), window);

    expect(datasource.services[0].unknown).toEqual(['stream_labels', 'service_namespace']);
  });

  it('scopes queries to the one indexed namespace when the streams call fails', async () => {
    const { get, calls } = fakeLoki({ seriesFails: true });

    const { datasource } = await collectLokiInventory('loki', get, createLimiter(4), window);

    expect(datasource.services[0]).toMatchObject({ service_namespace: 'shop', unknown: ['stream_labels'] });
    expect(calls.find((call) => call.path === '/loki/api/v1/detected_fields')?.params.query).toBe(
      '{service_name="checkout", service_namespace="shop"}'
    );
  });

  it('marks volume unknown when neither index volume nor index stats answer', async () => {
    const { get } = fakeLoki({ volumeFails: true, statsFails: true });

    const { datasource } = await collectLokiInventory('loki', get, createLimiter(4), window);

    expect(datasource.services[0]).toMatchObject({ volume: 0, unknown: ['volume'] });
  });

  it('leaves unknown unset when every step answers', async () => {
    const { get } = fakeLoki();

    const { datasource } = await collectLokiInventory('loki', get, createLimiter(4), window);

    expect(datasource.services[0].unknown).toBeUndefined();
  });
});

describe('scorer limits', () => {
  it('skips a Loki datasource with more services than the scorer accepts', async () => {
    const { get, calls } = fakeLoki({
      serviceNames: Array.from({ length: MAX_LOG_SERVICES + 1 }, (_, index) => `svc-${index}`),
    });

    const { datasource, errors } = await collectLokiInventory('loki', get, createLimiter(4), window);

    expect(datasource.services).toEqual([]);
    expect(calls.some((call) => call.path === '/loki/api/v1/series')).toBe(false);
    expect(errors.map((error) => error.message)).toContain(
      `${MAX_LOG_SERVICES + 1} found, over the ${MAX_LOG_SERVICES} the scorer accepts, so this datasource was not scanned`
    );
  });
});

describe('streamSelector', () => {
  it('escapes the service name', () => {
    expect(streamSelector({ name: 'integrations/db-o11y' })).toBe('{service_name="integrations/db-o11y"}');
    expect(streamSelector({ name: 'we"ird' })).toBe('{service_name="we\\"ird"}');
  });

  it('matches the namespace, and its absence, when one is given', () => {
    expect(streamSelector({ name: 'api', namespace: 'shop' })).toBe('{service_name="api", service_namespace="shop"}');
    expect(streamSelector({ name: 'api', namespace: '' })).toBe('{service_name="api", service_namespace=""}');
  });
});
