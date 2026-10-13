import { ProxyGet } from '../datasources/proxy';
import { createLimiter } from '../datasources/limiter';
import { AssessmentResult } from '../api/types';
import { Inventory } from '../inventory/types';
import { assessStack, mergeOwners } from './stackAssessment';

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
      },
      { get, limit: createLimiter(4), score, spanGroupRules: async () => [], namesNeedingLabels: async () => [] }
    );

    const [inventory, weighted] = score.mock.calls[0];
    expect(inventory.traces.map((ds) => ds.uid)).toEqual(['tempo']);
    expect(inventory.metrics?.map((ds) => [ds.uid, ds.strategy_override])).toEqual([['prom', 'NoTranslation']]);
    expect(inventory.logs?.map((ds) => ds.uid)).toEqual(['loki']);
    expect(inventory.reclassification).toEqual([{ pattern: 'acme_*', action: 'exclude' }]);
    expect(weighted).toBe(true);
  });
});
