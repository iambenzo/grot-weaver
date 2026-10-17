import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { ServiceReadinessRow, SignalReadinessRow } from '../../api/types';
import { ProductReadiness } from './ProductReadiness';

const checkout = { kind: 'service' as const, namespace: 'shop', name: 'checkout' };
const ratio = (value: number | null) => ({ value, numerator: 0, denominator: 0 });
const signal = (name: SignalReadinessRow['signal'], value: number | null, lists: Partial<SignalReadinessRow>) => ({
  signal: name,
  readiness: ratio(value),
  present: [],
  missing: [],
  unknown: [],
  missing_recommended: [],
  ...lists,
});
const row = (
  product: string,
  product_name: string,
  overall: number | null,
  signals: SignalReadinessRow[]
): ServiceReadinessRow => ({
  kind: 'service',
  name: 'checkout',
  product,
  product_name,
  overall: ratio(overall),
  signals,
});

describe('ProductReadiness', () => {
  it('shows ready, partially ready and not checkable signals', () => {
    render(
      <ProductReadiness
        rows={[
          row('knowledge-graph', 'Knowledge Graph', 2 / 3, [
            signal('traces', 2 / 3, {
              present: ['service.name', 'service.namespace'],
              missing: ['deployment.environment.name'],
              missing_recommended: ['k8s.pod.name'],
            }),
            signal('metrics', null, { unknown: ['service.instance.id'] }),
          ]),
          row('application-observability', 'Application Observability', 1, [
            signal('traces', 1, { present: ['service.name'] }),
          ]),
        ]}
        owner={checkout}
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
    const { container } = render(<ProductReadiness rows={[]} owner={checkout} signals={['traces']} />);

    expect(container).toBeEmptyDOMElement();
  });
});
