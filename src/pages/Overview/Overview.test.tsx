import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ScoreTiles, scoreTiles } from './ScoreTiles';
import { weightingText } from './PlatformOverview';
import { ServicesTable } from './ServicesTable';
import { serviceLink } from '../../utils/serviceLink';
import { OwnerSections } from './OwnerSections';
import { TopViolations } from './TopViolations';
import { ViolationGroup } from '../../assessment/overview';
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
    expect(screen.getByText('All pass')).toBeInTheDocument();
    expect(screen.getAllByText('Some fail')).toHaveLength(3);
    expect(screen.queryByText('None pass')).not.toBeInTheDocument();
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

    expect(basis['Naming: Stable']).toBe('1,500 of 3,000 weighted by series');
    expect(basis['Requirements']).toBe('1,500 of 3,000 weighted by series');
    expect(basis['Resource']).toBe('1,500 of 3,000 checks');
  });

  it('allows for unmeasured volume when weighted scores have nothing to divide by', () => {
    const empty = { value: null, numerator: 0, denominator: 0 };
    const row = {
      owner: { kind: 'service' as const, name: '' },
      signal: 'traces' as const,
      scores: {
        naming_stable: empty,
        naming_release_candidate: empty,
        naming_experimental: empty,
        requirements: empty,
        resource: empty,
        required_resource: empty,
        deprecated: 0,
        unclassified: 0,
        custom: 0,
      },
    };

    const basis = Object.fromEntries(
      scoreTiles({ signal: 'traces', row, volumeWeighted: true }).map((tile) => [tile.label, tile.basis])
    );

    expect(basis['Naming: Stable']).toBe('No stable names seen, or none with measured volume');
    expect(basis['Requirements']).toBe('No required attributes to check, or none with measured volume');
    expect(basis['Resource']).toBe('No service identity to check');
  });
});

describe('ScoreTiles required resource attributes', () => {
  it('says how many attributes could not be checked', () => {
    const basis = Object.fromEntries(
      scoreTiles({
        signal: 'metrics',
        row: {
          owner: { kind: 'service', name: '' },
          signal: 'metrics',
          scores: {
            naming_stable: { value: null, numerator: 0, denominator: 0 },
            naming_release_candidate: { value: null, numerator: 0, denominator: 0 },
            naming_experimental: { value: null, numerator: 0, denominator: 0 },
            requirements: { value: null, numerator: 0, denominator: 0 },
            resource: { value: null, numerator: 0, denominator: 0 },
            required_resource: { value: 1, numerator: 1, denominator: 1 },
            deprecated: 0,
            unclassified: 0,
            custom: 0,
          },
        },
        uncheckable: 3,
      }).map((tile) => [tile.label, tile.basis])
    );

    expect(basis['Required resource attributes']).toBe('1 of 1 checks, 3 not checkable');
  });
});

describe('weightingText', () => {
  it('says how names are counted', () => {
    expect(weightingText(false)).toBe('Each name counts once per service, whatever its volume.');
    expect(weightingText(true)).toBe('Each name counts by its volume in each service: series, spans or log lines.');
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

    expect(serviceLink(row.owner, { from: 'now-24h', to: 'now' })).toBe(
      '/a/benburbage-semconvcompliance-app/service?service=checkout&from=now-24h&to=now&namespace=shop'
    );
    render(<ServicesTable rows={[row]} range={{ from: 'now-24h', to: 'now' }} />);
    expect(screen.getByRole('link', { name: 'shop/checkout' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Lowest naming score' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Traces: stable naming' })).toBeInTheDocument();
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

  it('opens a section that has owners and explains what it holds', () => {
    const result = {
      findings: [
        {
          type: 'not_in_registry',
          level: 'violation',
          signal: 'metrics',
          owner: { kind: 'source', name: 'node' },
          observed: 'node_cpu_seconds_total',
          scope: 'metric',
          volume: 1,
          impact_share: 0,
        },
      ],
      metric_attributions: [],
    } as unknown as AssessmentResult;

    render(<OwnerSections result={result} />);

    expect(screen.getByText('node')).toBeVisible();
    expect(screen.getByText(/no OpenTelemetry SDK service identity/)).toBeVisible();
    expect(screen.queryByText(/OTEL_SERVICE_NAME/)).toBeNull();
  });

  it('opens a section when its first owners arrive in a later result', () => {
    const empty = { findings: [], metric_attributions: [] } as unknown as AssessmentResult;
    const later = {
      findings: [
        {
          type: 'not_in_registry',
          level: 'violation',
          signal: 'metrics',
          owner: { kind: 'source', name: 'node' },
          observed: 'node_cpu_seconds_total',
          scope: 'metric',
          volume: 1,
          impact_share: 0,
        },
      ],
      metric_attributions: [],
    } as unknown as AssessmentResult;
    const { rerender } = render(<OwnerSections result={empty} />);

    rerender(<OwnerSections result={later} />);

    expect(screen.getByText('node')).toBeVisible();
  });
});

describe('TopViolations', () => {
  const range = { from: 'now-24h', to: 'now' };
  const group = (index: number): ViolationGroup => ({
    key: `traces|deprecated|name.${index}`,
    signal: 'traces',
    type: 'deprecated',
    name: `name.${index}`,
    observed: [`name.${index}`],
    services: 1,
    owners: [{ kind: 'service', namespace: 'shop', name: 'checkout' }],
    libraries: [],
    volume: 1,
    impactShare: 0,
  });

  it('links an expanded violation to each affected service on its signal', () => {
    render(<TopViolations groups={[group(1)]} range={range} semconvVersion="v1.44.0" />);

    fireEvent.click(screen.getByRole('button', { name: /toggle row expanded/i }));

    expect(screen.getByRole('link', { name: 'shop/checkout' })).toHaveAttribute(
      'href',
      '/a/benburbage-semconvcompliance-app/service?service=checkout&from=now-24h&to=now&namespace=shop&signal=traces'
    );
  });

  it('says when the list is capped', () => {
    render(
      <TopViolations
        groups={Array.from({ length: 30 }, (_, index) => group(index))}
        range={range}
        semconvVersion="v1.44.0"
      />
    );

    expect(screen.getByText(/Showing the top 25 of 30 violations/)).toBeInTheDocument();
  });
});
