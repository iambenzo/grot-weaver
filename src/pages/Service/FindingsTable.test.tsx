import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { FindingsTable } from './FindingsTable';
import { Finding } from '../../api/types';
import { LibraryInfo } from '../../assessment/libraries';

const owner = { kind: 'service' as const, namespace: 'shop', name: 'checkout' };

const renamed: Finding = {
  type: 'deprecated',
  level: 'violation',
  signal: 'traces',
  owner,
  observed: 'http.method',
  scope: 'spans',
  matched: 'http.method',
  expected: 'http.request.method',
  bucket: 'stable',
  source: 'core',
  volume: 0,
  impact_share: 0,
};

const noReplacement: Finding = {
  ...renamed,
  observed: 'net_peer_name',
  matched: 'net.peer.name',
  expected: undefined,
  bucket: 'experimental',
  note: 'Replaced by `server.address` on client spans and `client.address` on server spans.',
};

const library: LibraryInfo = {
  libraries: [{ name: '@opentelemetry/instrumentation-http', version: '0.218.0' }],
  firstSeenMs: Date.UTC(2026, 9, 12, 8),
  lastSeenMs: Date.UTC(2026, 9, 13, 9),
  confidence: 'high',
  description: 'from TraceQL metrics',
};
const none = () => undefined;

describe('FindingsTable', () => {
  it('shows found and expected names, badges, library and first/last seen', () => {
    render(<FindingsTable findings={[renamed]} libraryFor={() => library} exploreFor={() => '/explore?x'} />);

    expect(screen.getByText('http.method')).toBeInTheDocument();
    expect(screen.getByText('http.request.method')).toBeInTheDocument();
    expect(screen.getByText('Deprecated')).toBeInTheDocument();
    expect(screen.getByText('Stable')).toBeInTheDocument();
    expect(screen.getByText('semconv')).toBeInTheDocument();
    expect(screen.getByText(/instrumentation-http/)).toBeInTheDocument();
    expect(screen.getByText('high confidence, from TraceQL metrics')).toBeInTheDocument();
    expect(screen.getByText('2026-10-12 08:00:00')).toBeInTheDocument();
    expect(screen.getByText('2026-10-13 09:00:00')).toBeInTheDocument();
  });

  it('offers Open in Explore in the expanded row', () => {
    render(<FindingsTable findings={[renamed]} libraryFor={() => library} exploreFor={() => '/explore?x'} />);

    fireEvent.click(screen.getByRole('button', { name: /toggle row expanded/i }));

    expect(screen.getByRole('link', { name: /open in explore/i })).toHaveAttribute('href', '/explore?x');
  });

  it('marks a likely library and says the library is unknown otherwise', () => {
    const likely = { ...library, likely: true, confidence: 'medium' as const, description: 'likely: from traces' };
    const { unmount } = render(<FindingsTable findings={[renamed]} libraryFor={() => likely} exploreFor={none} />);
    expect(screen.getByText('Likely')).toBeInTheDocument();
    unmount();

    render(<FindingsTable findings={[renamed]} libraryFor={none} exploreFor={none} />);
    expect(screen.getByText('library unknown')).toBeInTheDocument();
  });

  it('shows the stored form next to the registry name', () => {
    render(<FindingsTable findings={[noReplacement]} libraryFor={none} exploreFor={none} />);

    const row = screen.getByText('net_peer_name').closest('tr') as HTMLElement;
    expect(within(row).getByText('net.peer.name')).toBeInTheDocument();
    expect(within(row).getByText('Experimental')).toBeInTheDocument();
  });

  it('shows the registry note verbatim when there is no single replacement', () => {
    render(<FindingsTable findings={[noReplacement]} libraryFor={none} exploreFor={none} />);

    fireEvent.click(screen.getByRole('button', { name: /toggle row expanded/i }));

    expect(screen.getByText(noReplacement.note as string)).toBeInTheDocument();
  });

  it('describes a missing required attribute by group', () => {
    const missing: Finding = {
      ...renamed,
      type: 'required_attribute_not_present',
      observed: 'span.http.server',
      expected: 'url.scheme',
      matched: undefined,
      bucket: undefined,
      source: undefined,
      confidence: 'medium',
    };

    render(<FindingsTable findings={[missing]} libraryFor={none} exploreFor={none} />);

    expect(screen.getByText('url.scheme').closest('span')?.textContent).toBe(
      'url.scheme missing from span.http.server spans'
    );
    expect(screen.getByText('Required missing')).toBeInTheDocument();
    expect(screen.getByText('medium confidence')).toBeInTheDocument();
  });

  it('says series for metric requirements and puts violations first', () => {
    const metricMissing: Finding = {
      ...renamed,
      type: 'required_attribute_not_present',
      signal: 'metrics',
      observed: 'http.client.request.duration',
      expected: 'server.port',
    };
    const improvement: Finding = {
      ...renamed,
      type: 'recommended_attribute_not_present',
      level: 'improvement',
      observed: 'span.http.server',
      expected: 'client.address',
    };

    render(<FindingsTable findings={[improvement, metricMissing]} libraryFor={none} exploreFor={none} />);

    const rows = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.textContent ?? '');
    expect(rows[0]).toContain('server.port missing from http.client.request.duration series');
    expect(rows[1]).toContain('client.address missing from span.http.server spans');
  });
});
