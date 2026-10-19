import { Observable } from 'rxjs';
import { ProxyGet, createProxyGet } from '../datasources/proxy';
import { createLimiter } from '../datasources/limiter';
import { AssessmentResult } from '../api/types';
import { Inventory } from '../inventory/types';
import {
  DatasourceProgress,
  MAX_SERIES_PRESENCE_CHECKS,
  PARTIAL_SCORING_MAX_SERVICES,
  collectedServices,
  StackAssessment,
  StackDependencies,
  assessStack,
  mergeOwners,
  retryDatasource,
  seriesPresenceAttributes,
} from './stackAssessment';

const fetch = jest.fn();

jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  getBackendSrv: () => ({ fetch }),
}));

const checkout = { kind: 'service' as const, namespace: 'shop', name: 'checkout' };

describe('mergeOwners', () => {
  it('merges one service across signals and lists aliases that differ only by namespace', () => {
    const result = {
      attributions: [{ owner: checkout }],
      metric_attributions: [
        { owner: checkout },
        { owner: { kind: 'service', name: 'checkout' } },
        { owner: { kind: 'source', name: 'node' } },
      ],
      log_attributions: [{ owner: checkout }],
    } as unknown as AssessmentResult;

    const identities = mergeOwners(result);

    const shopCheckout = identities.find((identity) => identity.owner.namespace === 'shop');
    expect(shopCheckout?.signals).toEqual(['traces', 'metrics', 'logs']);
    expect(shopCheckout?.aliases).toEqual([{ kind: 'service', name: 'checkout' }]);
    expect(identities.find((identity) => identity.owner.kind === 'source')?.aliases).toEqual([]);
  });
});

describe('seriesPresenceAttributes', () => {
  const deps = (
    renamedAttributes?: StackDependencies['renamedAttributes'],
    products?: StackDependencies['products']
  ): StackDependencies => ({
    get: jest.fn(),
    limit: createLimiter(1),
    score: jest.fn(),
    spanGroupRules: async () => [],
    namesNeedingLabels: async () => [],
    renamedAttributes,
    products,
  });

  it('adds the deprecated names of each required attribute', async () => {
    const renamed = async () => ({
      'deployment.environment.name': ['deployment.environment'],
      'other.name': ['other'],
    });
    expect(
      await seriesPresenceAttributes({ requiredResourceAttributes: ['deployment.environment.name'] }, deps(renamed))
    ).toEqual(['deployment.environment.name', 'deployment.environment']);
  });

  it('still checks the required attributes when the renamed lookup fails', async () => {
    const failing = async () => Promise.reject(new Error('down'));
    expect(await seriesPresenceAttributes({ requiredResourceAttributes: ['service.name'] }, deps(failing))).toEqual([
      'service.name',
    ]);
  });

  it('adds product attributes after the required list and its deprecated names', async () => {
    const products = async () => [
      {
        id: 'kg',
        name: 'KG',
        summary: '',
        requirements: [
          {
            signal: 'metrics' as const,
            attribute: 'k8s.pod.name',
            level: 'recommended' as const,
            source: 'https://grafana.com/docs/x',
          },
        ],
      },
    ];

    const attributes = await seriesPresenceAttributes(
      { requiredResourceAttributes: ['service.name'] },
      deps(undefined, products)
    );

    expect(attributes).toEqual(['service.name', 'k8s.pod.name']);
  });

  it('leaves out product attributes that only matter on traces or logs', async () => {
    const products = async () => [
      {
        id: 'kg',
        name: 'KG',
        summary: '',
        requirements: [
          {
            signal: 'traces' as const,
            attribute: 'telemetry.sdk.name',
            level: 'required' as const,
            source: 'https://grafana.com/docs/x',
          },
        ],
      },
    ];

    const attributes = await seriesPresenceAttributes(
      { requiredResourceAttributes: ['service.name'] },
      deps(undefined, products)
    );

    expect(attributes).toEqual(['service.name']);
  });

  it('still returns the required list when products cannot be fetched', async () => {
    const failing = async () => {
      throw new Error('boom');
    };

    const attributes = await seriesPresenceAttributes(
      { requiredResourceAttributes: ['service.name'] },
      deps(undefined, failing)
    );

    expect(attributes).toEqual(['service.name']);
  });

  it('caps the flags so the inventory stays within the backend limit, keeping the required list first', async () => {
    const required = Array.from({ length: 50 }, (_, i) => `required.${i}`);
    const renamed = async () => Object.fromEntries(required.map((attribute) => [attribute, [`${attribute}.old`]]));
    const products = async () => [
      {
        id: 'kg',
        name: 'KG',
        summary: '',
        requirements: [
          {
            signal: 'metrics' as const,
            attribute: 'k8s.pod.name',
            level: 'required' as const,
            source: 'https://grafana.com/docs/x',
          },
        ],
      },
    ];

    const attributes = await seriesPresenceAttributes(
      { requiredResourceAttributes: required },
      deps(renamed, products)
    );

    expect(attributes).toHaveLength(MAX_SERIES_PRESENCE_CHECKS);
    expect(attributes.slice(0, 50)).toEqual(required);
    expect(attributes).not.toContain('k8s.pod.name');
  });
});

describe('assessStack', () => {
  it('collects all three signals into one score request with settings applied', async () => {
    const get = (async (_uid: string, requestPath: string) => {
      if (requestPath.endsWith('/values')) {
        return { status: 'success', data: [], tagValues: [] };
      }
      if (requestPath === '/api/v2/search/tags') {
        return { scopes: [] };
      }
      return { status: 'success', data: requestPath === '/api/v1/query' ? { result: [] } : [] };
    }) as ProxyGet;
    const score = jest.fn(
      async (_inventory: Inventory, _weighted: boolean) => ({ findings: [] }) as unknown as AssessmentResult
    );

    await assessStack(
      {
        metrics: [{ uid: 'prom', type: 'prometheus', name: 'P' }],
        traces: [{ uid: 'tempo', type: 'tempo', name: 'T' }],
        logs: [{ uid: 'loki', type: 'loki', name: 'L' }],
      },
      { startSeconds: 1, endSeconds: 2 },
      {
        volumeWeighted: true,
        strategyOverrides: { prom: 'NoTranslation' },
        reclassification: [{ pattern: 'acme_*', action: 'exclude' }],
        pipelineMappings: [
          { match: 'shop/*', pipeline: 'edge' },
          { match: '', pipeline: 'incomplete' },
        ],
        customNamespaces: ['acme'],
        requiredResourceAttributes: ['service.name', 'team.name'],
      },
      { get, limit: createLimiter(4), score, spanGroupRules: async () => [], namesNeedingLabels: async () => [] }
    );

    const [inventory, weighted] = score.mock.calls[0];
    expect(inventory.traces.map((ds) => ds.uid)).toEqual(['tempo']);
    expect(inventory.metrics?.map((ds) => [ds.uid, ds.strategy_override])).toEqual([['prom', 'NoTranslation']]);
    expect(inventory.logs?.map((ds) => ds.uid)).toEqual(['loki']);
    expect(inventory.reclassification).toEqual([{ pattern: 'acme_*', action: 'exclude' }]);
    expect(weighted).toBe(true);
    expect(inventory.pipeline_mappings).toEqual([{ match: 'shop/*', pipeline: 'edge' }]);
    expect(inventory.custom_namespaces).toEqual(['acme']);
    expect(inventory.required_resource_attributes).toEqual(['service.name', 'team.name']);
  });
});

describe('progress, partial results and retry', () => {
  const datasources = {
    metrics: [{ uid: 'prom', type: 'prometheus', name: 'P' }],
    traces: [{ uid: 'tempo', type: 'tempo', name: 'T' }],
    logs: [{ uid: 'loki', type: 'loki', name: 'L' }],
  };
  const window = { startSeconds: 1, endSeconds: 2 };

  function fakeStack(denied: string[], tempoServices = 0) {
    const get = (async (uid: string, requestPath: string) => {
      if (denied.includes(uid)) {
        throw { status: 403, data: { message: 'Access denied to this data source' } };
      }
      if (requestPath === '/api/v2/search/tag/resource.service.name/values') {
        return { tagValues: Array.from({ length: tempoServices }, (_, index) => ({ value: `svc-${index}` })) };
      }
      if (requestPath.endsWith('/values')) {
        return { status: 'success', data: [], tagValues: [] };
      }
      if (requestPath === '/api/v2/search/tags') {
        return { scopes: [] };
      }
      return { status: 'success', data: requestPath === '/api/v1/query' ? { result: [] } : [] };
    }) as ProxyGet;
    const score = jest.fn(
      async (inventory: Inventory) =>
        ({
          findings: [],
          scored: [...inventory.traces, ...(inventory.metrics ?? []), ...(inventory.logs ?? [])].map((ds) => ds.uid),
        }) as unknown as AssessmentResult
    );
    const progress: DatasourceProgress[][] = [];
    const partials: StackAssessment[] = [];
    const deps = {
      get,
      limit: createLimiter(4),
      score,
      spanGroupRules: async () => [],
      namesNeedingLabels: async () => [],
      onProgress: (update: DatasourceProgress[]) => progress.push(update),
      onPartial: (assessment: StackAssessment) => partials.push(assessment),
    };
    return { deps, score, progress, partials };
  }

  it('starts with every datasource pending and ends with each state', async () => {
    const { deps, progress } = fakeStack(['loki']);

    const assessment = await assessStack(datasources, window, {}, deps);

    expect(progress[0].map((entry) => entry.state)).toEqual(['pending', 'pending', 'pending']);
    expect(assessment.partial).toBe(false);
    expect(assessment.progress.map((entry) => [entry.ref.uid, entry.state])).toEqual([
      ['prom', 'ok'],
      ['tempo', 'ok'],
      ['loki', 'not_visible'],
    ]);
  });

  it('scores what has arrived as partial before the final score', async () => {
    const { deps, partials, score } = fakeStack([]);

    const assessment = await assessStack(datasources, window, {}, deps);

    expect(partials.length).toBeGreaterThan(0);
    expect(partials.every((partial) => partial.partial)).toBe(true);
    expect(partials.every((partial) => partial.collections.length < 3)).toBe(true);
    expect(score).toHaveBeenCalledTimes(partials.length + 1);
    expect((assessment.result as unknown as { scored: string[] }).scored).toEqual(['tempo', 'prom', 'loki']);
  });

  it('scores only once, at the end, once the collected stack is larger than the partial-scoring limit', async () => {
    const { deps, partials, score, progress } = fakeStack([], PARTIAL_SCORING_MAX_SERVICES + 1);
    const slowTempo = deps.get;
    deps.get = (async (uid: string, path: string, params: Record<string, string>) => {
      if (uid !== 'tempo') {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return slowTempo(uid, path, params);
    }) as ProxyGet;

    const assessment = await assessStack(datasources, window, {}, deps);

    expect(partials).toEqual([]);
    expect(score).toHaveBeenCalledTimes(1);
    expect(assessment.partial).toBe(false);
    expect(progress.length).toBeGreaterThanOrEqual(4);
    expect(progress[progress.length - 1].map((entry) => entry.state)).toEqual(['ok', 'ok', 'ok']);
  });

  it('retries one datasource and keeps the others', async () => {
    const first = fakeStack(['loki']);
    const previous = await assessStack(datasources, window, {}, first.deps);
    const second = fakeStack([]);

    const retried = await retryDatasource(previous, 'loki', window, {}, second.deps);

    expect(retried.progress.find((entry) => entry.ref.uid === 'loki')?.state).toBe('ok');
    expect(retried.collections.map((collection) => collection.ref.uid)).toEqual(['prom', 'tempo', 'loki']);
    expect(second.partials).toEqual([]);
  });

  it('reports how Tempo keys and volumes were collected', async () => {
    const { deps } = fakeStack([]);
    const get = deps.get;
    deps.get = (async (uid: string, requestPath: string, params: Record<string, string>) => {
      if (uid === 'tempo' && requestPath.endsWith('resource.service.name/values')) {
        return { tagValues: [{ type: 'string', value: 'checkout' }] };
      }
      if (uid === 'tempo' && requestPath === '/api/metrics/query_range') {
        return {
          series: [
            {
              labels: [{ key: 'resource.service.name', value: { stringValue: 'checkout' } }],
              samples: [{ timestampMs: '1', value: 5 }],
            },
          ],
        };
      }
      return get(uid, requestPath, params);
    }) as ProxyGet;

    const assessment = await assessStack(datasources, window, {}, deps);

    expect(assessment.progress.find((entry) => entry.ref.uid === 'tempo')).toMatchObject({
      keysMethod: 'tags',
      volumeMethod: 'metrics',
    });
  });
});

describe('cancellation through the collectors', () => {
  it('starts no new datasource request after the run is aborted and cancels the ones in flight', async () => {
    const unsubscribed = jest.fn();
    let twoStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      twoStarted = resolve;
    });
    fetch.mockReset();
    fetch.mockImplementation(() => {
      if (fetch.mock.calls.length === 2) {
        twoStarted();
      }
      return new Observable(() => unsubscribed);
    });
    const controller = new AbortController();
    const score = jest.fn(async () => ({}) as AssessmentResult);
    const running = assessStack(
      { metrics: [], traces: [{ uid: 'tempo', type: 'tempo', name: 'Tempo' }], logs: [] },
      { startSeconds: 0, endSeconds: 3600 },
      {},
      {
        get: createProxyGet(controller.signal),
        limit: createLimiter(2),
        score,
        spanGroupRules: async () => [],
        namesNeedingLabels: async () => [],
      }
    );
    await started;
    await Promise.resolve();
    const startedBeforeAbort = fetch.mock.calls.length;

    controller.abort();
    await running;

    expect(startedBeforeAbort).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(startedBeforeAbort);
    expect(unsubscribed).toHaveBeenCalledTimes(startedBeforeAbort);
  });
});

describe('collectedServices', () => {
  const ref = { uid: 'prom', type: 'prometheus', name: 'P' };
  const metrics = (owners: Array<Record<string, string>>, targetInfo: Array<Record<string, string>> = []) => ({
    ref,
    signal: 'metrics' as const,
    errors: [],
    metrics: {
      uid: 'prom',
      names: [],
      target_info: targetInfo,
      owners: owners.flatMap((labels) => [
        { metric: 'http_server_request_duration_seconds', labels, series: 1 },
        { metric: 'process_cpu_seconds_total', labels, series: 1 },
      ]),
      label_keys: [],
      collectors: [],
    },
  });

  it('counts each metric owner once, however many metrics it sends', () => {
    const owners = Array.from({ length: 1200 }, (_, index) => ({ job: `svc-${index}` }));

    expect(collectedServices([metrics(owners)])).toBe(1200);
  });

  it('counts services named only by target_info, once each', () => {
    expect(
      collectedServices([
        metrics([{ job: 'a' }], [{ job: 'a', instance: '1' }, { job: 'a', instance: '2' }, { job: 'b' }, { job: 'c' }]),
      ])
    ).toBe(3);
  });

  it('counts one service once across scopes, presence flags and label order', () => {
    expect(
      collectedServices([
        metrics([
          { job: 'shop/cart', service_name: 'cart', otel_scope_name: 'http' },
          { otel_scope_name: 'db', service_name: 'cart', job: 'shop/cart' },
          { job: 'shop/cart', service_name: 'cart', __present_service_instance_id: '1' },
        ]),
      ])
    ).toBe(1);
  });

  it('adds trace and log services across datasources', () => {
    const traces = { ref, signal: 'traces' as const, errors: [], traces: { uid: 't', services: [{}, {}] } };
    const logs = { ref, signal: 'logs' as const, errors: [], logs: { uid: 'l', labels: [], services: [{}] } };

    expect(collectedServices([traces, logs, metrics([{ job: 'a' }])] as never)).toBe(4);
  });
});
