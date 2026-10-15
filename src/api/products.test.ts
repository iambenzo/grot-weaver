import { Product, metricProductAttributes } from './products';

describe('metricProductAttributes', () => {
  it('lists every metrics attribute and alternative once, ignoring other signals', () => {
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
          {
            signal: 'metrics',
            attribute: 'deployment.environment',
            level: 'required',
            source: 'https://grafana.com/docs/z',
          },
        ],
      },
    ];

    expect(metricProductAttributes(products)).toEqual(['deployment.environment.name', 'deployment.environment']);
  });
});
