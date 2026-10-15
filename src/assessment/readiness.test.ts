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

  it('reports present attributes with unknown ones and nothing missing as not checkable', () => {
    const [kg] = serviceReadiness(
      [row(checkout, 'traces', { present: ['service.name'], unknown: ['deployment.environment.name'] })],
      [checkout]
    );

    expect(kg.signals.traces?.share).toBeNull();
    expect(kg.overall).toBeNull();
  });

  it('reports the share of the checked attributes when something is missing and something is unknown', () => {
    const [kg] = serviceReadiness(
      [
        row(checkout, 'traces', {
          present: ['service.name'],
          missing: ['service.namespace'],
          unknown: ['deployment.environment.name'],
        }),
      ],
      [checkout]
    );

    expect(kg.signals.traces?.share).toBeCloseTo(1 / 2);
    expect(kg.overall).toBeCloseTo(1 / 2);
  });

  it('is not checkable overall when no signal has anything missing and any has unknown attributes', () => {
    const [kg] = serviceReadiness(
      [
        row(checkout, 'traces', { present: ['service.name'] }),
        row(checkout, 'metrics', { present: ['service.name'], unknown: ['service.instance.id'] }),
      ],
      [checkout]
    );

    expect(kg.signals.traces?.share).toBe(1);
    expect(kg.signals.metrics?.share).toBeNull();
    expect(kg.overall).toBeNull();
  });

  it('is partial overall when one signal is missing something and another has unknown attributes', () => {
    const [kg] = serviceReadiness(
      [
        row(checkout, 'traces', { present: ['service.name'], missing: ['service.namespace'] }),
        row(checkout, 'metrics', { present: ['service.name'], unknown: ['service.instance.id'] }),
      ],
      [checkout]
    );

    expect(kg.overall).toBeCloseTo(2 / 3);
  });
});
