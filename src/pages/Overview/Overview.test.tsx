import React from 'react';
import { render, screen } from '@testing-library/react';
import { ScoreTiles, scoreTiles } from './ScoreTiles';
import { weightingText } from './PlatformOverview';
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
        required_resource: { value: 0.25, numerator: 1, denominator: 4 },
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
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(screen.getByText('Required resource attributes')).toBeInTheDocument();
    expect(screen.getByText('1 of 2 names')).toBeInTheDocument();
    expect(screen.getByText('No release-candidate names seen')).toBeInTheDocument();
    expect(screen.getByText('No required attributes to check')).toBeInTheDocument();
    expect(screen.getByText('9 of 10 spans')).toBeInTheDocument();
  });

  it('counts naming and requirements in volume when scores are volume weighted', () => {
    const ratio = { value: 0.5, numerator: 1500.4, denominator: 3000 };
    const row = {
      owner: { kind: 'service' as const, name: '' },
      signal: 'metrics' as const,
      scores: {
        naming_stable: ratio,
        naming_release_candidate: ratio,
        naming_experimental: ratio,
        requirements: ratio,
        resource: ratio,
        required_resource: ratio,
        deprecated: 0,
        unclassified: 0,
        custom: 0,
      },
    };

    const basis = Object.fromEntries(
      scoreTiles({ signal: 'metrics', row, volumeWeighted: true }).map((tile) => [tile.label, tile.basis])
    );

    expect(basis['Naming: Stable']).toBe('1,500 of 3,000 series');
    expect(basis['Requirements']).toBe('1,500 of 3,000 series');
    expect(basis['Resource']).toBe('1,500 of 3,000 checks');
  });
});

describe('weightingText', () => {
  it('says how names are counted', () => {
    expect(weightingText(false)).toBe('Each distinct name counts once, whatever its volume.');
    expect(weightingText(true)).toBe('Names count by volume: series, spans or log lines.');
  });
});

describe('ScoreTiles coverage', () => {
  it('says how many services were left out because their volume was not measured', () => {
    render(
      <ScoreTiles signal="logs" row={undefined} coverage={{ value: 1, numerator: 4, denominator: 4 }} unmeasured={2} />
    );

    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('4 of 4 log lines, 2 services unmeasured')).toBeInTheDocument();
  });
});

describe('ServicesTable', () => {
  it('links each service to the developer view with its namespace and window', () => {
    const row = {
      owner: { kind: 'service' as const, namespace: 'shop', name: 'checkout' },
      scores: {},
      worst: 0.4,
      violations: 3,
      requiredResource: { value: 0.8, numerator: 4, denominator: 5 },
    };

    expect(serviceLink(row, { from: 'now-24h', to: 'now' })).toBe(
      '/a/iambenzo-semconvcompliance-app/service?service=checkout&from=now-24h&to=now&namespace=shop'
    );
    render(<ServicesTable rows={[row]} range={{ from: 'now-24h', to: 'now' }} />);
    expect(screen.getByRole('link', { name: 'shop/checkout' })).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
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
