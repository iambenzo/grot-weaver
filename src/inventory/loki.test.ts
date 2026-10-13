import fs from 'fs';
import path from 'path';
import { ProxyGet } from '../datasources/proxy';
import { createLimiter } from '../datasources/limiter';
import { collectLokiInventory, streamSelector } from './loki';

const fixture = (name: string) => JSON.parse(fs.readFileSync(path.resolve(__dirname, `../../testdata/fixtures/local/loki/${name}`), 'utf8'));
const window = { startSeconds: 100, endSeconds: 1900 };

function fakeLoki(options: { detectedFieldsFail?: boolean } = {}) {
  const calls: Array<{ path: string; params: Record<string, string>; headers?: Record<string, string> }> = [];
  const get = (async (_uid: string, requestPath: string, params: Record<string, string>, headers?: Record<string, string>) => {
    calls.push({ path: requestPath, params, headers });
    switch (requestPath) {
      case '/loki/api/v1/labels':
        return fixture('labels.json');
      case '/loki/api/v1/label/service_name/values':
        return { status: 'success', data: ['checkout'] };
      case '/loki/api/v1/series':
        return fixture('series-checkout.json');
      case '/loki/api/v1/detected_fields':
        if (options.detectedFieldsFail) {
          throw { status: 404, data: { message: 'not found' } };
        }
        return fixture('detected-fields-checkout.json');
      case '/loki/api/v1/query_range':
        return fixture('sample-checkout.json');
      case '/loki/api/v1/query':
        return fixture('volume-checkout.json');
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
    expect(checkout.metadata_keys).toEqual(expect.arrayContaining(['http_method', 'http_request_method', 'trace_id', 'scope_name']));
    expect(checkout.stream_labels).toEqual(['deployment_environment_name', 'service_instance_id', 'service_name', 'service_namespace']);
    expect(checkout.otlp_markers).toEqual(expect.arrayContaining(['scope_name', 'severity_number', 'observed_timestamp', 'flags', 'telemetry_sdk_name']));

    const sampleCall = calls.find((call) => call.path === '/loki/api/v1/query_range');
    expect(sampleCall?.params).toMatchObject({ query: '{service_name="checkout"}', limit: '5', start: '100000000000', end: '1900000000000' });
    expect(sampleCall?.headers).toEqual({ 'X-Loki-Response-Encoding-Flags': 'categorize-labels' });
  });

  it('falls back to a larger sample for keys when detected fields are unavailable', async () => {
    const { get, calls } = fakeLoki({ detectedFieldsFail: true });

    const { datasource, errors } = await collectLokiInventory('loki', get, createLimiter(4), window);

    expect(errors).toEqual([]);
    expect(datasource.services[0].keys_method).toBe('sample');
    expect(datasource.services[0].metadata_keys).toEqual(expect.arrayContaining(['http_method', 'scope_name']));
    expect(calls.filter((call) => call.path === '/loki/api/v1/query_range').map((call) => call.params.limit).sort()).toEqual(['20', '5']);
  });
});

describe('streamSelector', () => {
  it('escapes the service name', () => {
    expect(streamSelector('integrations/db-o11y')).toBe('{service_name="integrations/db-o11y"}');
    expect(streamSelector('we"ird')).toBe('{service_name="we\\"ird"}');
  });
});
