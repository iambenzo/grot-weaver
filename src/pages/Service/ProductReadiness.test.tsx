import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { ProductReadiness as ReadinessRow } from '../../api/types';
import { ProductReadiness } from './ProductReadiness';

const checkout = { kind: 'service' as const, namespace: 'shop', name: 'checkout' };
const row = (
  product: string,
  product_name: string,
  signal: ReadinessRow['signal'],
  lists: Partial<ReadinessRow>
): ReadinessRow => ({
  owner: checkout,
  signal,
  product,
  product_name,
  readiness: { value: null, numerator: 0, denominator: 0 },
  present: [],
  missing: [],
  unknown: [],
  missing_recommended: [],
  ...lists,
});

describe('ProductReadiness', () => {
  it('shows ready, partially ready and not checkable signals', () => {
    render(
      <ProductReadiness
        rows={[
          row('knowledge-graph', 'Knowledge Graph', 'traces', {
            present: ['service.name', 'service.namespace'],
            missing: ['deployment.environment.name'],
            missing_recommended: ['k8s.pod.name'],
          }),
          row('knowledge-graph', 'Knowledge Graph', 'metrics', { unknown: ['service.instance.id'] }),
          row('application-observability', 'Application Observability', 'traces', { present: ['service.name'] }),
        ]}
        owners={[checkout]}
        signals={['metrics', 'traces', 'logs']}
      />
    );

    const kg = screen.getByRole('row', { name: /Knowledge Graph/ });
    expect(within(kg).getAllByText('67%')).toHaveLength(2);
    expect(within(kg).getByText(/deployment\.environment\.name/)).toBeInTheDocument();
    expect(within(kg).getByText(/k8s\.pod\.name/)).toBeInTheDocument();
    expect(within(kg).getByText('Not checkable')).toBeInTheDocument();
    expect(within(kg).queryByText('0%')).not.toBeInTheDocument();
    expect(within(kg).getByText('N/A')).toBeInTheDocument();

    const ao = screen.getByRole('row', { name: /Application Observability/ });
    expect(within(ao).getAllByText('100%')).toHaveLength(2);
  });

  it('renders nothing when the service has no readiness rows', () => {
    const { container } = render(<ProductReadiness rows={[]} owners={[checkout]} signals={['traces']} />);

    expect(container).toBeEmptyDOMElement();
  });
});
