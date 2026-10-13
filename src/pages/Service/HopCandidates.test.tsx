import React from 'react';
import { render, screen } from '@testing-library/react';
import { HopCandidates } from './HopCandidates';

describe('HopCandidates', () => {
  it('presents hops as ranked candidates with their reasons, never as confirmed', () => {
    render(
      <HopCandidates
        hops={{
          owner: { kind: 'service', name: 'weather-app' },
          candidates: [
            {
              pipeline: 'alloy-ecs',
              reasons: ['component "/remotecfg/shop_ecs_weather_app.default" mentions weather-app'],
              score: 40,
            },
            { pipeline: 'alloy-receiver', reasons: ['admin mapping "x" matches weather-app'], score: 10 },
          ],
        }}
      />
    );

    expect(screen.getByText('Most likely candidate')).toBeInTheDocument();
    expect(screen.getByText('Candidate')).toBeInTheDocument();
    expect(screen.getByText(/candidates, not\s+confirmed hops/)).toBeInTheDocument();
    expect(screen.getByText(/shop_ecs_weather_app/)).toBeInTheDocument();
  });

  it('renders nothing without candidates', () => {
    const { container } = render(<HopCandidates hops={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
