import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { AssessmentResult } from '../../api/types';
import { DatasourceProgress } from '../../assessment/stackAssessment';
import {
  EmptyTelemetry,
  FeatureLimits,
  LoadingProgress,
  SavedScanNotice,
  StackStatus,
  hasOTelServices,
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

describe('StackStatus', () => {
  it('marks partial results with how many datasources are in', () => {
    render(<StackStatus progress={[prom, tempo]} partial onRetry={jest.fn()} />);

    expect(screen.getByTestId(testIds.status.partial)).toHaveTextContent('Scores cover 1 of 2 datasources so far');
  });

  it('lists datasources the viewer cannot query and says scores cover only visible ones', () => {
    render(<StackStatus progress={[prom, lokiDenied]} partial={false} onRetry={jest.fn()} />);

    const notice = screen.getByTestId(testIds.status.notVisible);
    expect(notice).toHaveTextContent('Scores cover only the datasources you can query');
    expect(notice).toHaveTextContent('Not visible to you: Loki.');
    expect(screen.queryByTestId(testIds.status.partial)).not.toBeInTheDocument();
  });

  it('shows errors per datasource with a retry for that datasource', () => {
    const onRetry = jest.fn();
    render(<StackStatus progress={[prom, tempoFailed]} partial={false} onRetry={onRetry} />);

    expect(screen.getByTestId(testIds.status.datasourceErrors)).toHaveTextContent('tempo exploded');
    fireEvent.click(screen.getByRole('button', { name: /retry tempo/i }));
    expect(onRetry).toHaveBeenCalledWith('tempo');
  });

  it('says when no datasources were found', () => {
    render(<StackStatus progress={[]} partial={false} onRetry={jest.fn()} />);

    expect(screen.getByText('No metrics, trace or log datasources found')).toBeInTheDocument();
  });
});

describe('FeatureLimits', () => {
  it('names sampled span volume and uncheckable units', () => {
    const sampled = { ...tempo, state: 'ok' as const, volumeMethod: 'sample' as const, keysMethod: 'sample' as const };
    const summaries = result({
      datasources: [{ uid: 'prom', strategy: 'UnderscoreEscapingWithoutSuffixes', unit_checkable: false }],
    } as unknown as Partial<AssessmentResult>);

    render(<FeatureLimits progress={[prom, sampled]} result={summaries} />);

    const limits = screen.getByTestId(testIds.status.limits);
    expect(limits).toHaveTextContent('Tempo: volume from sample');
    expect(limits).toHaveTextContent('Tempo: keys from sample');
    expect(limits).toHaveTextContent('Prometheus: unit not checkable');
  });

  it('names capped label key checks as a limit, not a failure', () => {
    const capped = { ...prom, state: 'ok' as const, labelChecks: { checked: 1000, total: 1500 } };

    render(<FeatureLimits progress={[capped]} result={result({})} />);

    expect(screen.getByTestId(testIds.status.limits)).toHaveTextContent(
      'Prometheus: label keys checked for the 1000 busiest of 1500 metric and owner pairs'
    );
  });

  it('names services whose volume was sampled beside measured ones', () => {
    const mixed = { ...tempo, state: 'ok' as const, volumeMethod: 'mixed' as const };

    render(<FeatureLimits progress={[mixed]} result={result({})} />);

    expect(screen.getByTestId(testIds.status.limits)).toHaveTextContent(
      'Tempo: volume from sample for services missing from TraceQL metrics'
    );
  });

  it('names services whose volume could not be measured', () => {
    const failed = { ...lokiDenied, state: 'errors' as const, errors: [], unmeasuredVolumes: 2 };

    render(<FeatureLimits progress={[failed]} result={result({})} />);

    expect(screen.getByTestId(testIds.status.limits)).toHaveTextContent(
      'Loki: volume not measured for 2 services because the query failed, so their findings rank last'
    );
  });

  it('renders nothing without limits', () => {
    const { container } = render(<FeatureLimits progress={[prom]} result={result({})} />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe('SavedScanNotice', () => {
  it('says the saved scan is showing while a fresh one runs', () => {
    render(<SavedScanNotice savedAtMs={Date.now() - 2 * 60 * 60 * 1000} />);

    expect(screen.getByTestId(testIds.status.saved)).toHaveTextContent('Showing your saved scan from 2 hours ago');
    expect(screen.getByTestId(testIds.status.saved)).toHaveTextContent('A fresh scan is running');
  });

  it('names a failed fresh scan', () => {
    render(<SavedScanNotice savedAtMs={Date.now()} refreshError="boom" />);

    expect(screen.getByTestId(testIds.status.saved)).toHaveTextContent('The fresh scan failed: boom');
  });

  it('renders nothing without a saved scan', () => {
    const { container } = render(<SavedScanNotice />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe('EmptyTelemetry', () => {
  it('links to instrumentation docs and counts sources and unattributed owners', () => {
    const empty = result({
      metric_attributions: [{ owner: { kind: 'source', name: 'node' } }, { owner: { kind: 'source', name: 'mysql' } }],
      attributions: [{ owner: { kind: 'unattributed', name: '' } }],
    } as unknown as Partial<AssessmentResult>);

    render(<EmptyTelemetry result={empty} />);

    expect(hasOTelServices(empty)).toBe(false);
    expect(screen.getByTestId(testIds.status.empty)).toHaveTextContent('2 sources');
    expect(screen.getByTestId(testIds.status.empty)).toHaveTextContent('1 unattributed owners');
    expect(screen.getByRole('link', { name: /opentelemetry language guides/i })).toHaveAttribute(
      'href',
      'https://opentelemetry.io/docs/languages/'
    );
  });
});
