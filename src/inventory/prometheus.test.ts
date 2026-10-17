import fs from 'fs';
import path from 'path';
import { ProxyGet } from '../datasources/proxy';
import { createLimiter } from '../datasources/limiter';
import { MAX_OWNER_ATTEMPTS_PER_BATCH } from './queryBudget';
import {
  MAX_LABEL_KEY_CALLS,
  anonymousOwnersQuery,
  collectPrometheusInventory,
  collectorsQuery,
  labelsMatcher,
  nameMatcher,
  ownerSelector,
  isRecordingRule,
  ownersQuery,
} from './prometheus';

const fixture = (target: string, name: string) =>
  JSON.parse(fs.readFileSync(path.resolve(__dirname, `../../testdata/fixtures/${target}/prometheus/${name}`), 'utf8'));
const window = { startSeconds: 1000, endSeconds: 1000 + 86400 };

type Override = (requestPath: string, params: Record<string, string>) => unknown;

function fakePrometheus(target: string, failing?: string, override?: Override) {
  const calls: Array<{ path: string; params: Record<string, string> }> = [];
  const get = (async (_uid: string, requestPath: string, params: Record<string, string>) => {
    calls.push({ path: requestPath, params });
    if (failing && requestPath === failing) {
      throw { status: 422, data: { error: 'too many series' } };
    }
    const overridden = override?.(requestPath, params);
    if (overridden !== undefined) {
      return overridden;
    }
    if (requestPath === '/api/v1/cardinality/label_values') {
      return { labels: [{ cardinality: [] }] };
    }
    if (requestPath === '/api/v1/label/__name__/values') {
      return fixture(target, 'metric-names.json');
    }
    if (requestPath === '/api/v1/series') {
      return fixture(target, 'target-info-series.json');
    }
    if (requestPath === '/api/v1/labels') {
      return fixture(target, 'owner-label-names.json');
    }
    if (params.query.startsWith('count by (__name__, instance)')) {
      return {
        status: 'success',
        data: {
          result: [{ metric: { __name__: 'envoy_cluster_upstream_cx_total', instance: 'envoy-1' }, value: [1, '3'] }],
        },
      };
    }
    return {
      status: 'success',
      data: {
        result: [
          {
            metric: { __name__: 'http_server_request_duration_seconds_bucket', job: 'shop/checkout' },
            value: [1, '12'],
          },
          { metric: { __name__: 'envoy_cluster_upstream_cx_total' }, value: [1, '3'] },
        ],
      },
    };
  }) as ProxyGet;
  return { get, calls };
}

describe('collectPrometheusInventory', () => {
  it('collects names, target_info and owners within the window', async () => {
    const { get, calls } = fakePrometheus('local');

    const { datasource, errors } = await collectPrometheusInventory('prom', get, createLimiter(4), window);

    expect(errors).toEqual([]);
    expect(datasource.names.length).toBe(fixture('local', 'metric-names.json').data.length);
    expect(datasource.target_info.some((labels) => labels.job === 'node-via-otelcol-otlp')).toBe(true);
    expect(datasource.target_info.every((labels) => !('__name__' in labels))).toBe(true);
    const nameCalls = calls.filter(
      (call) => call.path !== '/api/v1/query' && call.path !== '/api/v1/cardinality/label_values'
    );
    expect(nameCalls.every((call) => call.params.start === '1000' && call.params.end === '87400')).toBe(true);
    expect(calls.filter((call) => call.path === '/api/v1/query').every((call) => call.params.time === '87400')).toBe(
      true
    );
  });

  it('batches owner queries and re-queries identity-less series by instance', async () => {
    const { get, calls } = fakePrometheus('cloud');

    const { datasource } = await collectPrometheusInventory('prom', get, createLimiter(4), window);

    const names = (fixture('cloud', 'metric-names.json').data as string[]).filter((name) => !isRecordingRule(name));
    const ownerCalls = calls.filter((call) => call.params.query?.startsWith('count by (__name__, job'));
    expect(ownerCalls.length).toBe(Math.ceil(names.length / 40));
    expect(ownerCalls.some((call) => call.params.query?.includes('asserts:'))).toBe(false);
    expect(datasource.owners).toContainEqual({
      metric: 'http_server_request_duration_seconds_bucket',
      labels: { job: 'shop/checkout' },
      series: 12,
    });
    expect(datasource.owners).toContainEqual({
      metric: 'envoy_cluster_upstream_cx_total',
      labels: { instance: 'envoy-1' },
      series: 3,
    });
    expect(
      datasource.owners.some((owner) => owner.metric === 'envoy_cluster_upstream_cx_total' && !owner.labels.instance)
    ).toBe(false);
  });

  it('keeps going when one step fails', async () => {
    const { get } = fakePrometheus('local', '/api/v1/series');

    const { datasource, errors } = await collectPrometheusInventory('prom', get, createLimiter(4), window);

    expect(errors).toEqual([
      { datasource: 'prom', step: 'target_info series', message: 'too many series', status: 422 },
    ]);
    expect(datasource.names.length).toBeGreaterThan(0);
    expect(datasource.target_info).toEqual([]);
  });
});

describe('per-owner label keys', () => {
  it('asks for label names per matched metric and owner, once per pair', async () => {
    const { get, calls } = fakePrometheus('local');
    const progress: Array<{ done: number; total: number }> = [];

    const { datasource } = await collectPrometheusInventory(
      'prom',
      get,
      createLimiter(4),
      window,
      async () => ['http_server_request_duration_seconds_bucket'],
      (update) => progress.push(update)
    );

    const labelCalls = calls.filter((call) => call.path === '/api/v1/labels');
    expect(labelCalls.map((call) => call.params['match[]'])).toEqual([
      '{__name__="http_server_request_duration_seconds_bucket", job="shop/checkout"}',
    ]);
    expect(labelCalls[0].params).toMatchObject({ start: '1000', end: '87400' });
    expect(datasource.label_keys).toEqual([
      {
        metric: 'http_server_request_duration_seconds_bucket',
        selector: { job: 'shop/checkout' },
        keys: fixture('local', 'owner-label-names.json').data.sort(),
      },
    ]);
    expect(progress[progress.length - 1]).toEqual({ done: 1, total: 1 });
  });

  it('skips label queries when nothing matches the registry', async () => {
    const { get, calls } = fakePrometheus('local');

    await collectPrometheusInventory('prom', get, createLimiter(4), window);

    expect(calls.some((call) => call.path === '/api/v1/labels')).toBe(false);
  });

  it.each([
    [{ job: 'a', service_name: 'b', instance: 'c' }, { job: 'a' }],
    [{ service_name: 'b', instance: 'c' }, { service_name: 'b' }],
    [{ instance: 'c' }, { instance: 'c' }],
    [{}, undefined],
  ])('selects the owner by %p', (labels, expected) => {
    expect(ownerSelector({ metric: 'm', labels, series: 1 })).toEqual(expected);
  });

  it('escapes selector values', () => {
    expect(labelsMatcher('http.server.duration', { job: 'a"b' })).toBe(
      '{__name__="http.server.duration", job="a\\"b"}'
    );
  });
});

describe('collector inventory', () => {
  it('queries collector self-metrics by collector, pod and component', () => {
    expect(collectorsQuery(window)).toBe(
      'count by (job, instance, collector_id, pod, workload, receiver, component_path, component_id) (last_over_time({__name__=~"otelcol_receiver_accepted_.+|alloy_build_info"}[86400s]))'
    );
  });

  it('adds collector label sets to the datasource', async () => {
    const { get } = fakePrometheus('local');

    const { datasource } = await collectPrometheusInventory('prom', get, createLimiter(4), window);

    expect(datasource.collectors.length).toBeGreaterThan(0);
  });
});

describe('queries', () => {
  it('escapes regex characters, including dots in UTF-8 names', () => {
    expect(nameMatcher(['http.server.request.duration_bucket', 'a+b'])).toBe(
      '{__name__=~"http\\\\.server\\\\.request\\\\.duration_bucket|a\\\\+b"}'
    );
  });

  it('counts owners over the whole window with last_over_time', () => {
    expect(ownersQuery(['up'], window)).toBe(
      'count by (__name__, job, service_name, service_namespace, otel_scope_name, otel_scope_version) (last_over_time({__name__=~"up"}[86400s]))'
    );
  });

  it('flags which required attributes are labels on the series without grouping by their values', () => {
    expect(ownersQuery(['up'], window, ['deployment.environment.name', 'service.version'])).toBe(
      'count by (__name__, job, service_name, service_namespace, otel_scope_name, otel_scope_version, semconv_has_deployment_environment_name, semconv_has_service_version) (label_replace(label_replace(last_over_time({__name__=~"up"}[86400s]), "semconv_has_deployment_environment_name", "1", "deployment_environment_name", ".+"), "semconv_has_service_version", "1", "service_version", ".+"))'
    );
  });

  it('treats colon names as recording rules', () => {
    expect(isRecordingRule('asserts:request:rate5m')).toBe(true);
    expect(isRecordingRule('http_server_request_duration_seconds_bucket')).toBe(false);
  });

  it('asks for instances only on series without job or service_name', () => {
    expect(anonymousOwnersQuery(['up'], window)).toBe(
      'count by (__name__, instance) (last_over_time({__name__=~"up", job="", service_name=""}[86400s]))'
    );
  });
});

describe('bounded owner queries', () => {
  const chunkLimit = {
    status: 422,
    data: {
      error: 'the query exceeded the maximum number of chunks (limit: 2000000 chunks) (err-mimir-max-chunks-per-query)',
    },
  };
  const ownerCalls = (calls: Array<{ path: string; params: Record<string, string> }>) =>
    calls.filter((call) => call.params.query?.startsWith('count by (__name__, job'));

  it('packs names by active series so a heavy name gets its own window slices', async () => {
    const { get, calls } = fakePrometheus('local', undefined, (requestPath) =>
      requestPath === '/api/v1/cardinality/label_values'
        ? {
            labels: [
              { cardinality: [{ label_value: 'http_server_request_duration_seconds_bucket', series_count: 900_000 }] },
            ],
          }
        : undefined
    );

    await collectPrometheusInventory('prom', get, createLimiter(4), window);

    const heavy = ownerCalls(calls).filter((call) =>
      call.params.query.includes('http_server_request_duration_seconds_bucket')
    );
    expect(heavy).toHaveLength(3);
    expect(heavy.every((call) => !call.params.query.includes('|'))).toBe(true);
    expect(heavy.map((call) => call.params.time).sort()).toEqual(['29800', '58600', '87400']);
    expect(heavy.every((call) => call.params.query.includes('[28800s]'))).toBe(true);
  });

  it('halves a batch that hits a Mimir query limit, then slices the window for a single name', async () => {
    const { get, calls } = fakePrometheus('local', undefined, (requestPath, params) => {
      const query = params.query ?? '';
      if (!query.startsWith('count by (__name__, job')) {
        return undefined;
      }
      if (
        query.includes('|') ||
        (query.includes('http_server_request_duration_seconds_bucket') && query.includes('[86400s]'))
      ) {
        throw chunkLimit;
      }
      const result = query.includes('http_server_request_duration_seconds_bucket')
        ? [
            {
              metric: { __name__: 'http_server_request_duration_seconds_bucket', job: 'shop/checkout' },
              value: [1, '12'],
            },
          ]
        : [];
      return { status: 'success', data: { result } };
    });

    const { datasource, errors } = await collectPrometheusInventory('prom', get, createLimiter(4), window);

    expect(errors).toEqual([]);
    const sliced = ownerCalls(calls).filter((call) => call.params.query.includes('[43200s]'));
    expect(sliced.map((call) => call.params.time).sort()).toEqual(['44200', '87400']);
    expect(datasource.owners.filter((owner) => owner.metric === 'http_server_request_duration_seconds_bucket')).toEqual(
      [{ metric: 'http_server_request_duration_seconds_bucket', labels: { job: 'shop/checkout' }, series: 12 }]
    );
  });

  it('still slices the window after halving a full batch down to one heavy name', async () => {
    const names = [...Array.from({ length: 39 }, (_, index) => `light_${index}`), 'heavy_total'];
    const { get, calls } = fakePrometheus('local', undefined, (requestPath, params) => {
      if (requestPath === '/api/v1/label/__name__/values') {
        return { status: 'success', data: names };
      }
      const query = params.query ?? '';
      if (!query.startsWith('count by (__name__, job')) {
        return undefined;
      }
      if (
        query.includes('heavy_total') &&
        (query.includes('|') || query.includes('[86400s]') || query.includes('[43200s]'))
      ) {
        throw chunkLimit;
      }
      const result = query.includes('heavy_total')
        ? [{ metric: { __name__: 'heavy_total', job: 'api' }, value: [1, '5'] }]
        : [];
      return { status: 'success', data: { result } };
    });

    const { datasource, errors } = await collectPrometheusInventory('prom', get, createLimiter(4), window);

    expect(errors).toEqual([]);
    expect(datasource.owners).toEqual([{ metric: 'heavy_total', labels: { job: 'api' }, series: 5 }]);
    expect(ownerCalls(calls).filter((call) => call.params.query.includes('[21600s]'))).toHaveLength(4);
  });

  it('stops splitting a batch once its query budget is used up', async () => {
    const names = Array.from({ length: 40 }, (_, index) => `heavy_${index}`);
    const { get, calls } = fakePrometheus('local', undefined, (requestPath, params) => {
      if (requestPath === '/api/v1/label/__name__/values') {
        return { status: 'success', data: names };
      }
      if (params.query?.startsWith('count by (__name__, job')) {
        throw chunkLimit;
      }
      return undefined;
    });

    const { errors } = await collectPrometheusInventory('prom', get, createLimiter(4), window);

    expect(ownerCalls(calls).length).toBe(MAX_OWNER_ATTEMPTS_PER_BATCH + 1);
    expect(errors.filter((error) => error.message.startsWith('stopped splitting'))).toHaveLength(1);
  });

  it('keeps the owners of a half that succeeded when the other half fails', async () => {
    const { get } = fakePrometheus('local', undefined, (requestPath, params) => {
      if (requestPath === '/api/v1/label/__name__/values') {
        return { status: 'success', data: ['good_total', 'bad_total'] };
      }
      const query = params.query ?? '';
      if (!query.startsWith('count by (__name__, job')) {
        return undefined;
      }
      if (query.includes('|')) {
        throw chunkLimit;
      }
      if (query.includes('bad_total')) {
        throw { status: 500, data: { error: 'boom' } };
      }
      return {
        status: 'success',
        data: { result: [{ metric: { __name__: 'good_total', job: 'api' }, value: [1, '2'] }] },
      };
    });

    const { datasource, errors } = await collectPrometheusInventory('prom', get, createLimiter(4), window);

    expect(datasource.owners).toEqual([{ metric: 'good_total', labels: { job: 'api' }, series: 2 }]);
    expect(errors).toEqual([
      { datasource: 'prom', step: 'owners batch 1/1', message: 'boom (for bad_total)', status: 500 },
    ]);
  });

  it('does not split on errors that are not query limits', async () => {
    const { get, calls } = fakePrometheus('local', undefined, (_requestPath, params) => {
      if (params.query?.startsWith('count by (__name__, job')) {
        throw { status: 500, data: { error: 'boom' } };
      }
      return undefined;
    });

    const { errors } = await collectPrometheusInventory('prom', get, createLimiter(4), window);

    const batches = Math.ceil(
      (fixture('local', 'metric-names.json').data as string[]).filter((name) => !isRecordingRule(name)).length / 40
    );
    expect(ownerCalls(calls)).toHaveLength(batches);
    expect(errors.every((error) => error.message === 'boom')).toBe(true);
  });
});

describe('label key budget', () => {
  it('checks only the busiest pairs and reports the cap as a limit', async () => {
    const owners = Array.from({ length: MAX_LABEL_KEY_CALLS + 2 }, (_, index) => ({
      metric: { __name__: 'http_server_request_duration_seconds_bucket', job: `svc-${index}` },
      value: [1, String(index + 1)],
    }));
    const { get, calls } = fakePrometheus('local', undefined, (_requestPath, params) =>
      params.query?.startsWith('count by (__name__, job') ? { status: 'success', data: { result: owners } } : undefined
    );

    const { errors, labelChecks } = await collectPrometheusInventory(
      'prom',
      get,
      createLimiter(8),
      window,
      async () => ['http_server_request_duration_seconds_bucket']
    );

    const checked = calls.filter((call) => call.path === '/api/v1/labels').map((call) => call.params['match[]']);
    expect(checked).toHaveLength(MAX_LABEL_KEY_CALLS);
    expect(checked.some((matcher) => matcher.includes('job="svc-0"'))).toBe(false);
    expect(checked.some((matcher) => matcher.includes(`job="svc-${MAX_LABEL_KEY_CALLS + 1}"`))).toBe(true);
    expect(errors).toEqual([]);
    expect(labelChecks).toEqual({ checked: MAX_LABEL_KEY_CALLS, total: MAX_LABEL_KEY_CALLS + 2 });
  });
});
