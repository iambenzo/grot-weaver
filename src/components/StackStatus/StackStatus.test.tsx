import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { AssessmentResult } from '../../api/types';
import { DatasourceProgress } from '../../assessment/stackAssessment';
import {
  EmptyTelemetry,
  emptyKind,
  LoadingProgress,
  ScanStatus,
  ScanWarnings,
  IncompleteNote,
  hasOTelServices,
  incompleteReasons,
  scanLimits,
  scanSummary,
} from './StackStatus';
import { testIds } from '../testIds';

const ref = (uid: string, name: string, type: string) => ({ uid, name, type });
const prom: DatasourceProgress = {
  ref: ref('prom', 'Prometheus', 'prometheus'),
  signal: 'metrics',
  state: 'ok',
  errors: [],
};
const tempo: DatasourceProgress = {
  ref: ref('tempo', 'Tempo', 'tempo'),
  signal: 'traces',
  state: 'pending',
  errors: [],
};
const lokiDenied: DatasourceProgress = {
  ref: ref('loki', 'Loki', 'loki'),
  signal: 'logs',
  state: 'not_visible',
  errors: [{ datasource: 'loki', step: 'service names', message: 'Access denied', status: 403 }],
};
const tempoFailed: DatasourceProgress = {
  ...tempo,
  state: 'errors',
  errors: [{ datasource: 'tempo', step: 'span keys for service "checkout"', message: 'tempo exploded', status: 500 }],
};

const result = (overrides: Partial<AssessmentResult>) =>
  ({ findings: [], attributions: [], metric_attributions: [], log_attributions: [], ...overrides }) as AssessmentResult;

describe('LoadingProgress', () => {
  it('shows each datasource with its signal and state', () => {
    render(<LoadingProgress progress={[prom, tempo]} />);

    expect(screen.getByText('Prometheus (metrics): done')).toBeInTheDocument();
    expect(screen.getByText('Tempo (traces): collecting')).toBeInTheDocument();
  });
});

describe('ScanStatus', () => {
  it('marks partial results with how many datasources are in, without an alert', () => {
    render(<ScanStatus progress={[prom, tempo]} partial limits={[]} />);

    expect(screen.getByTestId(testIds.status.partial)).toHaveTextContent('Scores cover 1 of 2 datasources so far');
    expect(screen.getByText('Tempo (traces): collecting')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says the scan finished and hides per-datasource progress', () => {
    render(<ScanStatus progress={[prom]} partial={false} limits={[]} />);

    expect(screen.getByTestId(testIds.status.partial)).toHaveTextContent('Scan finished across 1 datasource.');
    expect(screen.queryByTestId(testIds.status.progress)).not.toBeInTheDocument();
  });

  it('describes the progress as the fresh scan when a saved scan is showing', () => {
    render(
      <ScanStatus
        progress={[prom, tempo]}
        partial={false}
        limits={[]}
        savedAtMs={Date.now() - 2 * 60 * 60 * 1000}
        refreshing
      />
    );

    expect(screen.getByTestId(testIds.status.saved)).toHaveTextContent(
      'Showing your saved scan from 2 hours ago. A fresh scan is running, 1 of 2 datasources so far, and replaces it when it finishes.'
    );
  });

  it('says a fresh scan is running exactly while the store is still refreshing', () => {
    expect(scanSummary({ progress: [prom], partial: false, savedAtMs: Date.now(), refreshing: true })).toContain(
      'A fresh scan is running, 1 of 1 datasources so far'
    );
    expect(scanSummary({ progress: [prom], partial: false, savedAtMs: Date.now(), refreshing: false })).toBe(
      'Showing your saved scan from a few seconds ago.'
    );
  });

  it('keeps limited checks collapsed until asked', () => {
    const capped = { ...prom, labelChecks: { checked: 1000, total: 1500 } };
    render(<ScanStatus progress={[capped]} partial={false} limits={scanLimits([capped], result({}))} />);

    expect(screen.getByText('Limited checks (1)')).toBeInTheDocument();
    expect(screen.queryByText(/label keys checked/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Limited checks (1)'));

    expect(screen.getByTestId(testIds.status.limits)).toHaveTextContent(
      'Prometheus: label keys checked for the 1000 busiest of 1500 metric and owner pairs'
    );
  });

  it('renders nothing without datasources', () => {
    const { container } = render(<ScanStatus progress={[]} partial={false} limits={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe('ScanWarnings', () => {
  it('lists datasources the viewer cannot query and says scores cover only visible ones', () => {
    render(<ScanWarnings progress={[prom, lokiDenied]} onRetry={jest.fn()} />);

    const notice = screen.getByTestId(testIds.status.notVisible);
    expect(notice).toHaveTextContent('Scores cover only the datasources you can query');
    expect(notice).toHaveTextContent('Not visible to you: Loki.');
  });

  it('shows errors per datasource with a retry for that datasource', () => {
    const onRetry = jest.fn();
    render(<ScanWarnings progress={[prom, tempoFailed]} onRetry={onRetry} />);

    expect(screen.getByTestId(testIds.status.datasourceErrors)).toHaveTextContent('tempo exploded');
    fireEvent.click(screen.getByRole('button', { name: /retry tempo/i }));
    expect(onRetry).toHaveBeenCalledWith('tempo');
  });

  it('warns when the fresh scan failed and the saved scan is still showing', () => {
    render(<ScanWarnings progress={[prom]} onRetry={jest.fn()} savedAtMs={Date.now()} refreshError="boom" />);

    expect(screen.getByTestId(testIds.status.refreshFailed)).toHaveTextContent('The fresh scan failed');
    expect(screen.getByTestId(testIds.status.refreshFailed)).toHaveTextContent('boom');
  });

  it('renders nothing when all is well', () => {
    const { container } = render(<ScanWarnings progress={[prom]} onRetry={jest.fn()} savedAtMs={Date.now()} />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe('incompleteReasons', () => {
  it('names failures, hidden datasources and limits for one signal only', () => {
    const sampled = { ...tempo, state: 'ok' as const, keysMethod: 'sample' as const };
    const progress = [prom, sampled, tempoFailed, lokiDenied];

    expect(incompleteReasons(progress, scanLimits(progress, result({})), 'traces')).toEqual([
      'failed queries on Tempo',
      'keys from a sample',
    ]);
    expect(incompleteReasons([tempo], [], 'traces')).toEqual(['Tempo still collecting']);
    expect(incompleteReasons(progress, scanLimits(progress, result({})), 'logs')).toEqual(['Loki not visible to you']);
    expect(incompleteReasons(progress, scanLimits(progress, result({})), 'metrics')).toEqual([]);
  });

  it('renders a note only when there is a reason', () => {
    const { container } = render(<IncompleteNote reasons={[]} />);
    expect(container).toBeEmptyDOMElement();

    render(<IncompleteNote reasons={['keys from a sample']} />);
    expect(screen.getByTestId(testIds.status.incomplete)).toHaveTextContent(
      'Based on limited data: keys from a sample.'
    );
  });
});

describe('scanLimits', () => {
  it('names sampled span volume and uncheckable units', () => {
    const sampled = { ...tempo, state: 'ok' as const, volumeMethod: 'sample' as const, keysMethod: 'sample' as const };
    const summaries = result({
      datasources: [{ uid: 'prom', strategy: 'UnderscoreEscapingWithoutSuffixes', unit_checkable: false }],
    } as unknown as Partial<AssessmentResult>);

    const limits = scanLimits([prom, sampled], summaries)
      .map((limit) => limit.detail)
      .join('\n');

    expect(limits).toContain('Tempo: volume from sample');
    expect(limits).toContain('Tempo: keys from sample');
    expect(limits).toContain('Prometheus: unit not checkable');
  });

  it('names services whose volume was sampled beside measured ones', () => {
    const mixed = { ...tempo, state: 'ok' as const, volumeMethod: 'mixed' as const };

    expect(scanLimits([mixed], result({}))[0].detail).toContain(
      'Tempo: volume from sample for services missing from TraceQL metrics'
    );
  });

  it('names services whose volume could not be measured', () => {
    const failed = { ...lokiDenied, state: 'errors' as const, errors: [], unmeasuredVolumes: 2 };

    expect(scanLimits([failed], result({}))).toEqual([
      {
        signal: 'logs',
        summary: 'some volumes not measured',
        detail: 'Loki: volume not measured for 2 services because the query failed, so their findings show 0% impact',
      },
    ]);
  });

  it('is empty without limits', () => {
    expect(scanLimits([prom], result({}))).toEqual([]);
  });
});

describe('emptyKind', () => {
  const sources = result({
    metric_attributions: [{ owner: { kind: 'source', name: 'node' } }, { owner: { kind: 'source', name: 'mysql' } }],
    attributions: [{ owner: { kind: 'unattributed', name: '' } }],
  } as unknown as Partial<AssessmentResult>);

  it('tells no datasources, no telemetry and no OpenTelemetry services apart', () => {
    expect(emptyKind({ progress: [], result: result({}), partial: false })).toBe('no-datasources');
    expect(emptyKind({ progress: [prom], result: result({}), partial: false })).toBe('no-telemetry');
    expect(emptyKind({ progress: [prom], result: sources, partial: false })).toBe('no-otel-services');
    expect(emptyKind({ progress: [prom], result: sources, partial: true })).toBeUndefined();
  });

  it('does not call a scan with no readable datasource empty of telemetry', () => {
    expect(emptyKind({ progress: [tempoFailed, lokiDenied], result: result({}), partial: false })).toBe('unreadable');
    expect(emptyKind({ progress: [prom, tempoFailed], result: result({}), partial: false })).toBe('no-telemetry');

    render(<EmptyTelemetry kind="unreadable" result={result({})} />);

    expect(screen.getByText('Could not read your datasources')).toBeInTheDocument();
    expect(screen.queryByText('No telemetry found in this window')).not.toBeInTheDocument();
  });

  it('never claims telemetry exists when there are no datasources', () => {
    render(
      <EmptyTelemetry kind={emptyKind({ progress: [], result: result({}), partial: false })!} result={result({})} />
    );

    expect(screen.getByText('No metrics, trace or log datasources found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /add a datasource/i })).toHaveAttribute(
      'href',
      '/connections/datasources/new'
    );
    expect(screen.getByRole('link', { name: /app settings/i })).toHaveAttribute(
      'href',
      '/plugins/iambenzo-semconvcompliance-app'
    );
    expect(screen.queryByText(/Telemetry exists/)).not.toBeInTheDocument();
  });

  it('says when the datasources returned nothing', () => {
    render(<EmptyTelemetry kind="no-telemetry" result={result({})} />);

    expect(screen.getByText('No telemetry found in this window')).toBeInTheDocument();
    expect(screen.queryByText(/Telemetry exists/)).not.toBeInTheDocument();
  });

  it('links to instrumentation docs and counts sources and unattributed owners', () => {
    render(<EmptyTelemetry kind="no-otel-services" result={sources} />);

    expect(hasOTelServices(sources)).toBe(false);
    expect(screen.getByTestId(testIds.status.empty)).toHaveTextContent('2 sources');
    expect(screen.getByTestId(testIds.status.empty)).toHaveTextContent('1 unattributed owners');
    expect(screen.getByRole('link', { name: /opentelemetry language guides/i })).toHaveAttribute(
      'href',
      'https://opentelemetry.io/docs/languages/'
    );
  });
});
