import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { ResourceAttributeCheck } from '../../api/types';
import { ResourceAttributes } from './ResourceAttributes';

const checkout = { kind: 'service' as const, namespace: 'shop', name: 'checkout' };
const alias = { kind: 'service' as const, name: 'checkout' };
const check = (
  owner: typeof checkout | typeof alias,
  signal: ResourceAttributeCheck['signal'],
  attribute: string,
  state: ResourceAttributeCheck['state'],
  evidence = 'evidence'
): ResourceAttributeCheck => ({ owner, signal, attribute, state, evidence });

describe('ResourceAttributes', () => {
  it('shows each attribute by signal, preferring a present result from an alias', () => {
    render(
      <ResourceAttributes
        checks={[
          check(
            checkout,
            'traces',
            'deployment.environment.name',
            'missing',
            'only the deprecated deployment.environment'
          ),
          check(checkout, 'metrics', 'deployment.environment.name', 'unknown', 'no target_info'),
          check(alias, 'metrics', 'deployment.environment.name', 'present', 'target_info label'),
          check({ kind: 'service', name: 'cart' }, 'traces', 'team.name', 'missing'),
        ]}
        owners={[checkout, alias]}
        signals={['metrics', 'traces']}
      />
    );

    const row = screen.getByRole('row', { name: /deployment\.environment\.name/ });
    expect(within(row).getByText('Present')).toBeInTheDocument();
    expect(within(row).getByText('Missing')).toBeInTheDocument();
    expect(within(row).getByText('only the deprecated deployment.environment')).toBeInTheDocument();
    expect(screen.queryByText('team.name')).not.toBeInTheDocument();
    expect(screen.getByText(/OTEL_RESOURCE_ATTRIBUTES/)).toBeInTheDocument();
  });

  it('renders nothing when the service has no checks', () => {
    const { container } = render(<ResourceAttributes checks={[]} owners={[checkout]} signals={['traces']} />);
    expect(container).toBeEmptyDOMElement();
  });
});
