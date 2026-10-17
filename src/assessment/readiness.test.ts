import { ServiceReadinessRow } from '../api/types';
import { serviceReadiness } from './readiness';

const ratio = (value: number | null) => ({ value, numerator: 0, denominator: 0 });

const row = (name: string, overall: number | null): ServiceReadinessRow => ({
  kind: 'service',
  name,
  product: 'knowledge-graph',
  product_name: 'Knowledge Graph',
  overall: ratio(overall),
  signals: [
    {
      signal: 'traces',
      readiness: ratio(overall),
      present: ['service.name'],
      missing: ['service.namespace'],
      unknown: [],
      missing_recommended: ['k8s.pod.name'],
    },
  ],
});

describe('serviceReadiness', () => {
  it('returns the backend rows for the service by kind and name, whatever its namespace', () => {
    const [kg] = serviceReadiness([row('cart', 0), row('checkout', 0.5)], {
      kind: 'service',
      namespace: 'shop',
      name: 'checkout',
    });

    expect(kg).toEqual({
      product: 'knowledge-graph',
      name: 'Knowledge Graph',
      overall: 0.5,
      signals: {
        traces: {
          present: ['service.name'],
          missing: ['service.namespace'],
          unknown: [],
          missingRecommended: ['k8s.pod.name'],
          share: 0.5,
        },
      },
    });
  });

  it('keeps not checkable as null', () => {
    const [kg] = serviceReadiness([row('checkout', null)], { kind: 'service', name: 'checkout' });

    expect(kg.overall).toBeNull();
    expect(kg.signals.traces?.share).toBeNull();
  });

  it('returns nothing for another kind with the same name', () => {
    expect(serviceReadiness([row('checkout', 1)], { kind: 'unattributed', name: 'checkout' })).toEqual([]);
  });
});
