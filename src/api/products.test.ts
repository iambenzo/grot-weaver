import { Product, productAttributes } from './products';

describe('productAttributes', () => {
  it('lists every attribute and alternative once', () => {
    const products: Product[] = [
      {
        id: 'a',
        name: 'A',
        summary: '',
        requirements: [
          {
            signal: 'metrics',
            attribute: 'deployment.environment.name',
            alternatives: ['deployment.environment'],
            level: 'required',
            source: 'https://grafana.com/docs/x',
          },
          { signal: 'traces', attribute: 'k8s.pod.name', level: 'recommended', source: 'https://grafana.com/docs/y' },
        ],
      },
      {
        id: 'b',
        name: 'B',
        summary: '',
        requirements: [
          { signal: 'logs', attribute: 'k8s.pod.name', level: 'required', source: 'https://grafana.com/docs/z' },
        ],
      },
    ];

    expect(productAttributes(products)).toEqual([
      'deployment.environment.name',
      'deployment.environment',
      'k8s.pod.name',
    ]);
  });
});
