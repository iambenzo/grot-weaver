import React from 'react';
import { render, screen } from '@testing-library/react';
import { ScoreTiles } from './ScoreTiles';
import { ServicesTable, serviceLink } from './ServicesTable';
import { OwnerSections } from './OwnerSections';
import { AssessmentResult } from '../../api/types';

describe('ScoreTiles', () => {
  it('shows N/A when nothing is scored and percentages otherwise', () => {
    const row = {
      owner: { kind: 'service' as const, name: '' },
      signal: 'traces' as const,
      scores: {
        naming_stable: { value: 0.5, numerator: 1, denominator: 2 },
        naming_release_candidate: { value: null, numerator: 0, denominator: 0 },
        naming_experimental: { value: 1, numerator: 1, denominator: 1 },
        requirements: { value: null, numerator: 0, denominator: 0 },
        resource: { value: 0.75, numerator: 3, denominator: 4 },
        deprecated: 2,
        unclassified: 1,
        custom: 0,
      },
    };

    render(<ScoreTiles signal="traces" row={row} coverage={{ value: 0.9, numerator: 9, denominator: 10 }} />);

    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getAllByText('N/A')).toHaveLength(2);
    expect(screen.getByText('90%')).toBeInTheDocument();
    expect(screen.getByText('Coverage')).toBeInTheDocument();
  });
});

describe('ServicesTable', () => {
  it('links each service to the developer view with its namespace and window', () => {
    const row = {
      owner: { kind: 'service' as const, namespace: 'shop', name: 'checkout' },
      scores: {},
      worst: 0.4,
      violations: 3,
    };

    expect(serviceLink(row, { from: 'now-24h', to: 'now' })).toBe(
      '/a/iambenzo-semconvcompliance-app/service?service=checkout&from=now-24h&to=now&namespace=shop'
    );
    render(<ServicesTable rows={[row]} range={{ from: 'now-24h', to: 'now' }} />);
    expect(screen.getByRole('link', { name: 'shop/checkout' })).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
  });
});

describe('OwnerSections', () => {
  it('always shows pipelines, sources and unattributed, collapsed', () => {
    render(<OwnerSections result={{ findings: [], metric_attributions: [] } as unknown as AssessmentResult} />);

    for (const label of [
      'Pipelines (0)',
      'Sources (non-OTel and collector-scraped) (0)',
      'Unattributed (no service.name) (0)',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByText('No pipeline-introduced findings in this window.')).toBeNull();
  });
});
