import fs from 'fs';
import path from 'path';
import { ProxyGet } from '../datasources/proxy';
import { createLimiter } from '../datasources/limiter';
import { anonymousOwnersQuery, collectPrometheusInventory, nameMatcher, ownersQuery } from './prometheus';

const fixture = (target: string, name: string) =>
  JSON.parse(fs.readFileSync(path.resolve(__dirname, `../../testdata/fixtures/${target}/prometheus/${name}`), 'utf8'));
const window = { startSeconds: 1000, endSeconds: 1000 + 86400 };

function fakePrometheus(target: string, failing?: string) {
  const calls: Array<{ path: string; params: Record<string, string> }> = [];
  const get = (async (_uid: string, requestPath: string, params: Record<string, string>) => {
    calls.push({ path: requestPath, params });
    if (failing && requestPath === failing) {
      throw { status: 422, data: { error: 'too many series' } };
    }
    if (requestPath === '/api/v1/label/__name__/values') {
      return fixture(target, 'metric-names.json');
    }
    if (requestPath === '/api/v1/series') {
      return fixture(target, 'target-info-series.json');
    }
    if (params.query.startsWith('count by (__name__, instance)')) {
      return { status: 'success', data: { result: [{ metric: { __name__: 'envoy_cluster_upstream_cx_total', instance: 'envoy-1' }, value: [1, '3'] }] } };
    }
    return { status: 'success', data: { result: [
      { metric: { __name__: 'http_server_request_duration_seconds_bucket', job: 'shop/checkout' }, value: [1, '12'] },
      { metric: { __name__: 'envoy_cluster_upstream_cx_total' }, value: [1, '3'] },
    ] } };
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
    const nameCalls = calls.filter((call) => call.path !== '/api/v1/query');
    expect(nameCalls.every((call) => call.params.start === '1000' && call.params.end === '87400')).toBe(true);
    expect(calls.filter((call) => call.path === '/api/v1/query').every((call) => call.params.time === '87400')).toBe(true);
  });

  it('batches owner queries and re-queries identity-less series by instance', async () => {
    const { get, calls } = fakePrometheus('cloud');

    const { datasource } = await collectPrometheusInventory('prom', get, createLimiter(4), window);

    const names = fixture('cloud', 'metric-names.json').data.length;
    const ownerCalls = calls.filter((call) => call.params.query?.startsWith('count by (__name__, job'));
    expect(ownerCalls.length).toBe(Math.ceil(names / 40));
    expect(datasource.owners).toContainEqual({ metric: 'http_server_request_duration_seconds_bucket', labels: { job: 'shop/checkout' }, series: 12 });
    expect(datasource.owners).toContainEqual({ metric: 'envoy_cluster_upstream_cx_total', labels: { instance: 'envoy-1' }, series: 3 });
    expect(datasource.owners.some((owner) => owner.metric === 'envoy_cluster_upstream_cx_total' && !owner.labels.instance)).toBe(false);
  });

  it('keeps going when one step fails', async () => {
    const { get } = fakePrometheus('local', '/api/v1/series');

    const { datasource, errors } = await collectPrometheusInventory('prom', get, createLimiter(4), window);

    expect(errors).toEqual([{ datasource: 'prom', step: 'target_info series', message: 'too many series' }]);
    expect(datasource.names.length).toBeGreaterThan(0);
    expect(datasource.target_info).toEqual([]);
  });
});

describe('queries', () => {
  it('escapes regex characters, including dots in UTF-8 names', () => {
    expect(nameMatcher(['http.server.request.duration_bucket', 'a+b'])).toBe('{__name__=~"http\\\\.server\\\\.request\\\\.duration_bucket|a\\\\+b"}');
  });

  it('counts owners over the whole window with last_over_time', () => {
    expect(ownersQuery(['up'], window)).toBe(
      'count by (__name__, job, service_name, service_namespace, otel_scope_name, otel_scope_version) (last_over_time({__name__=~"up"}[86400s]))'
    );
  });

  it('asks for instances only on series without job or service_name', () => {
    expect(anonymousOwnersQuery(['up'], window)).toBe('count by (__name__, instance) (last_over_time({__name__=~"up", job="", service_name=""}[86400s]))');
  });
});
