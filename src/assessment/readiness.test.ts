import { ProductReadiness } from '../api/types';
import { serviceReadiness } from './readiness';

const checkout = { kind: 'service' as const, namespace: 'shop', name: 'checkout' };
const alias = { kind: 'service' as const, name: 'checkout' };

const row = (
  owner: ProductReadiness['owner'],
  signal: ProductReadiness['signal'],
  lists: Partial<ProductReadiness>
): ProductReadiness => ({
  owner,
  signal,
  product: 'knowledge-graph',
  product_name: 'Knowledge Graph',
  readiness: { value: null, numerator: 0, denominator: 0 },
  present: [],
  missing: [],
  unknown: [],
  missing_recommended: [],
  ...lists,
});

describe('serviceReadiness', () => {
  it('reports a fully ready service as 100%', () => {
    const [kg] = serviceReadiness(
      [row(checkout, 'traces', { present: ['service.name', 'service.namespace'] })],
      [checkout]
    );

    expect(kg.signals.traces?.share).toBe(1);
    expect(kg.overall).toBe(1);
  });

  it('reports a partially ready service with the missing attributes listed', () => {
    const [kg] = serviceReadiness(
      [
        row(checkout, 'traces', {
          present: ['service.name', 'service.namespace'],
          missing: ['deployment.environment.name'],
        }),
      ],
      [checkout]
    );

    expect(kg.signals.traces?.share).toBeCloseTo(2 / 3);
    expect(kg.signals.traces?.missing).toEqual(['deployment.environment.name']);
  });

  it('reports a signal where every requirement is unknown as not checkable, not 0%', () => {
    const [kg] = serviceReadiness([row(checkout, 'metrics', { unknown: ['service.instance.id'] })], [checkout]);

    expect(kg.signals.metrics?.share).toBeNull();
    expect(kg.overall).toBeNull();
  });

  it('lets a present attribute on one alias win over missing or unknown on another', () => {
    const [kg] = serviceReadiness(
      [
        row(checkout, 'metrics', {
          present: ['service.name'],
          missing: ['service.instance.id'],
          missing_recommended: ['k8s.pod.name'],
        }),
        row(alias, 'metrics', { present: ['service.instance.id'], unknown: ['service.name'] }),
      ],
      [checkout, alias]
    );

    expect(kg.signals.metrics).toEqual({
      present: ['service.name', 'service.instance.id'],
      missing: [],
      unknown: [],
      missingRecommended: [],
      share: 1,
    });
  });

  it('sums attribute-signal pairs for the overall share and ignores other services', () => {
    const [kg] = serviceReadiness(
      [
        row(checkout, 'traces', { present: ['service.name'], missing: ['service.namespace'] }),
        row(checkout, 'logs', { present: ['service.name', 'service.namespace'] }),
        row({ kind: 'service', name: 'cart' }, 'logs', { missing: ['service.name'] }),
      ],
      [checkout]
    );

    expect(kg.overall).toBeCloseTo(3 / 4);
  });
});
