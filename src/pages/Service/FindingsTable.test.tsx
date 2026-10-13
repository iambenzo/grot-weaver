import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { FindingsTable } from './FindingsTable';
import { Finding } from '../../api/types';
import { findingKey } from '../../assessment/traceAssessment';
import { LibraryEvidence } from '../../inventory/traceLibraries';

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

const evidence: LibraryEvidence = {
  libraries: [{ name: '@opentelemetry/instrumentation-http', version: '0.218.0', spans: 12 }],
  firstSeenMs: Date.UTC(2026, 9, 12, 8),
  lastSeenMs: Date.UTC(2026, 9, 13, 9),
  confidence: 'high',
  method: 'metrics',
};

describe('FindingsTable', () => {
  it('shows found and expected names, badges, library and first/last seen', () => {
    render(<FindingsTable findings={[renamed]} evidence={new Map([[findingKey(renamed), evidence]])} />);

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

  it('shows the stored form next to the registry name', () => {
    render(<FindingsTable findings={[noReplacement]} evidence={new Map()} />);

    const row = screen.getByText('net_peer_name').closest('tr') as HTMLElement;
    expect(within(row).getByText('net.peer.name')).toBeInTheDocument();
    expect(within(row).getByText('Experimental')).toBeInTheDocument();
  });

  it('shows the registry note verbatim when there is no single replacement', () => {
    render(<FindingsTable findings={[noReplacement]} evidence={new Map()} />);

    fireEvent.click(screen.getByRole('button', { name: /toggle row expanded/i }));

    expect(screen.getByText(noReplacement.note as string)).toBeInTheDocument();
  });

  it('describes a missing required attribute by group', () => {
    const missing: Finding = { ...renamed, type: 'required_attribute_not_present', observed: 'span.http.server', expected: 'url.scheme', matched: undefined, bucket: undefined, source: undefined, confidence: 'medium' };

    render(<FindingsTable findings={[missing]} evidence={new Map()} />);

    expect(screen.getByText('url.scheme').closest('span')?.textContent).toBe('url.scheme missing from span.http.server spans');
    expect(screen.getByText('Required missing')).toBeInTheDocument();
    expect(screen.getByText('medium confidence')).toBeInTheDocument();
  });
});
