import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { FixTabs } from './FixTabs';
import { Finding } from '../../api/types';
import { FixOptions } from '../../fix/fixOptions';
import { testIds } from '../../components/testIds';

const finding: Finding = {
  type: 'deprecated',
  level: 'violation',
  signal: 'traces',
  owner: { kind: 'service', namespace: 'shop', name: 'frontend' },
  observed: 'http.method',
  scope: 'spans',
  matched: 'http.method',
  expected: 'http.request.method',
  volume: 1,
  impact_share: 0.1,
};

const library = {
  libraries: [{ name: '@opentelemetry/instrumentation-http', version: '0.218.0' }],
  confidence: 'high' as const,
  description: 'from TraceQL metrics',
};

const available: FixOptions = {
  pipeline_rule: {
    available: true,
    label: 'starting point; test before deploying',
    collector: 'processors:\n  transform/semconv:\n',
    alloy: 'otelcol.processor.transform "semconv" {\n}\n',
  },
  guidance: {
    library: { name: '@opentelemetry/instrumentation-http', version: '0.218.0' },
    expected: 'http.request.method',
    docs_url: 'https://opentelemetry.io/docs/specs/semconv/registry/attributes/http/',
    opt_in: {
      variable: 'OTEL_SEMCONV_STABILITY_OPT_IN',
      value: 'http/dup',
      note: 'Supported in 0.54.0 to 0.220.0.',
      sources: ['https://github.com/open-telemetry/opentelemetry-js/blob/main/README.md'],
    },
  },
};

describe('FixTabs', () => {
  it('shows instrumentation guidance with the library, definition link and cited opt-in', async () => {
    const fetchFix = jest.fn(async () => available);

    render(<FixTabs finding={finding} library={library} semconvVersion="v1.44.0" fetchFix={fetchFix} />);

    expect(await screen.findByText(/Identified library/)).toHaveTextContent(
      '@opentelemetry/instrumentation-http 0.218.0'
    );
    expect(
      screen.getByRole('link', { name: /semantic convention definition of http.request.method/i })
    ).toHaveAttribute('href', 'https://opentelemetry.io/docs/specs/semconv/registry/attributes/http/');
    expect(screen.getByText('Set OTEL_SEMCONV_STABILITY_OPT_IN=http/dup')).toBeInTheDocument();
    expect(fetchFix).toHaveBeenCalledWith(finding, { name: '@opentelemetry/instrumentation-http', version: '0.218.0' });
  });

  it('shows labelled Collector and Alloy snippets on the pipeline tab', async () => {
    render(<FixTabs finding={finding} library={library} semconvVersion="v1.44.0" fetchFix={async () => available} />);
    await screen.findByText(/Identified library/);

    fireEvent.click(screen.getByRole('tab', { name: /pipeline rule/i }));

    expect(screen.getByText('Starting point; test before deploying')).toBeInTheDocument();
    expect(screen.getByText('OpenTelemetry Collector')).toBeInTheDocument();
    expect(screen.getByText('Grafana Alloy')).toBeInTheDocument();
    expect(screen.getByText(/transform\/semconv/)).toBeInTheDocument();
  });

  it('says why when a tab has nothing to offer', async () => {
    const empty: FixOptions = {
      pipeline_rule: { available: false, reason: 'The registry gives no single replacement.' },
      guidance: {},
    };
    render(
      <FixTabs finding={{ ...finding, expected: undefined }} semconvVersion="v1.44.0" fetchFix={async () => empty} />
    );

    expect(await screen.findByText(/could not be identified/)).toBeInTheDocument();
    expect(screen.getByText(/no one definition to link/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /pipeline rule/i }));
    expect(screen.getByText('The registry gives no single replacement.')).toBeInTheDocument();
  });

  it('offers a copyable summary for the owner', async () => {
    render(<FixTabs finding={finding} library={library} semconvVersion="v1.44.0" fetchFix={async () => available} />);
    await screen.findByText(/Identified library/);

    fireEvent.click(screen.getByRole('tab', { name: /raise with owner/i }));

    expect(screen.getByTestId(testIds.fix.summary)).toHaveTextContent('findings for shop/frontend');
    expect(screen.getByRole('button', { name: /copy summary/i })).toBeInTheDocument();
  });

  it('reports a failed request without hiding the summary', async () => {
    render(
      <FixTabs
        finding={finding}
        semconvVersion="v1.44.0"
        fetchFix={async () => {
          throw new Error('backend down');
        }}
      />
    );

    expect(await screen.findByText('backend down')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /raise with owner/i }));
    expect(screen.getByTestId(testIds.fix.summary)).toBeInTheDocument();
  });
});
