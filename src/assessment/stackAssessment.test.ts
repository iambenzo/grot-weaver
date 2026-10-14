import { ProxyGet } from '../datasources/proxy';
import { createLimiter } from '../datasources/limiter';
import { AssessmentResult } from '../api/types';
import { Inventory } from '../inventory/types';
import {
  DatasourceProgress,
  StackAssessment,
  StackDependencies,
  assessStack,
  mergeOwners,
  retryDatasource,
  seriesPresenceAttributes,
} from './stackAssessment';

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
  const deps = (renamedAttributes?: StackDependencies['renamedAttributes']): StackDependencies => ({
    get: jest.fn(),
    limit: createLimiter(1),
    score: jest.fn(),
    spanGroupRules: async () => [],
    namesNeedingLabels: async () => [],
    renamedAttributes,
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

  function fakeStack(denied: string[]) {
    const get = (async (uid: string, requestPath: string) => {
      if (denied.includes(uid)) {
        throw { status: 403, data: { message: 'Access denied to this data source' } };
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
      return get(uid, requestPath, params);
    }) as ProxyGet;

    const assessment = await assessStack(datasources, window, {}, deps);

    expect(assessment.progress.find((entry) => entry.ref.uid === 'tempo')).toMatchObject({
      keysMethod: 'tags',
      volumeMethod: 'metrics',
    });
  });
});
