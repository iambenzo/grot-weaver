import React from 'react';
import { of, throwError } from 'rxjs';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { AppPluginMeta, PluginType } from '@grafana/data';
import AppConfig, { AppConfigProps } from './AppConfig';
import { testIds } from '../testIds';

const fetch = jest.fn();
const reload = jest.fn();

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: () => ({ fetch }),
  getDataSourceSrv: () => ({
    getList: () => [
      { uid: 'prom', type: 'prometheus', name: 'Prometheus' },
      { uid: 'usage', type: 'prometheus', name: 'grafanacloud-usage' },
    ],
  }),
  locationService: { reload: () => reload() },
}));

function props(jsonData: object): AppConfigProps {
  const meta = {
    id: 'iambenzo-semconvcompliance-app',
    enabled: true,
    pinned: true,
    jsonData,
    type: PluginType.app,
  } as unknown as AppPluginMeta;
  return { plugin: { meta } } as unknown as AppConfigProps;
}

describe('AppConfig', () => {
  beforeEach(() => {
    fetch.mockReset().mockReturnValue(of({ data: {} }));
    reload.mockReset();
  });

  it('shows every settings group', () => {
    render(<AppConfig {...props({})} />);

    for (const group of ['Datasources', 'Metrics', 'Window and limits', 'Scoring', 'Pipelines', 'Updates']) {
      expect(screen.getByText(group)).toBeInTheDocument();
    }
    expect(screen.getByText('Translation strategy for Prometheus')).toBeInTheDocument();
  });

  it('gives every settings control an accessible name', () => {
    render(<AppConfig {...props({ pipelineMappings: [{ match: 'shop/*', pipeline: 'alloy' }] })} />);
    fireEvent.click(screen.getByRole('button', { name: /add rule/i }));

    for (const label of [
      'Concurrent queries',
      'Trace sample size',
      'Log sample size',
      'Default window',
      'Weight scores by volume',
      'Translation strategy for Prometheus',
      'Rule 1 metric name pattern',
      'Rule 1 action',
      'Mapping 1 service pattern',
      'Mapping 1 pipeline',
    ]) {
      expect(screen.getByLabelText(new RegExp(`^${label}`))).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Remove rule 1' })).toBeInTheDocument();
    const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('shows why a save failed and keeps the edited settings for a retry', async () => {
    fetch.mockReturnValue(throwError(() => ({ status: 403, data: { message: 'Permission denied' } })));
    render(<AppConfig {...props({})} />);

    fireEvent.click(screen.getByRole('button', { name: /add rule/i }));
    fireEvent.change(screen.getByPlaceholderText('traces_spanmetrics_*'), { target: { value: 'acme_*' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId(testIds.appConfig.submit));
    });

    expect(screen.getByTestId(testIds.appConfig.saveError)).toHaveTextContent('Permission denied');
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('traces_spanmetrics_*')).toHaveValue('acme_*');
    expect(screen.getByTestId(testIds.appConfig.submit)).toBeEnabled();
  });

  it('saves edited settings into jsonData, keeping existing values', async () => {
    render(<AppConfig {...props({ customNamespaces: ['acme'], defaultWindow: 'now-7d' })} />);

    fireEvent.click(screen.getByLabelText(/weight scores by volume/i));
    fireEvent.click(screen.getByRole('button', { name: /add rule/i }));
    fireEvent.change(screen.getByPlaceholderText('traces_spanmetrics_*'), { target: { value: 'acme_*' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId(testIds.appConfig.submit));
    });

    const request = fetch.mock.calls[0][0];
    expect(request).toMatchObject({
      url: '/api/plugins/iambenzo-semconvcompliance-app/settings',
      method: 'POST',
      showErrorAlert: false,
    });
    expect(request.data).toMatchObject({
      enabled: true,
      pinned: true,
      jsonData: {
        customNamespaces: ['acme'],
        defaultWindow: 'now-7d',
        volumeWeighted: true,
        reclassification: [{ pattern: 'acme_*', action: 'exclude' }],
      },
    });
    expect(reload).toHaveBeenCalled();
  });
});
