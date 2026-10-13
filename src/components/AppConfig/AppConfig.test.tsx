import React from 'react';
import { of } from 'rxjs';
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

  it('saves edited settings into jsonData, keeping existing values', async () => {
    render(<AppConfig {...props({ customNamespaces: ['acme'], defaultWindow: 'now-7d' })} />);

    fireEvent.click(screen.getByLabelText(/weight scores by volume/i));
    fireEvent.click(screen.getByRole('button', { name: /add rule/i }));
    fireEvent.change(screen.getByPlaceholderText('traces_spanmetrics_*'), { target: { value: 'acme_*' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId(testIds.appConfig.submit));
    });

    const request = fetch.mock.calls[0][0];
    expect(request).toMatchObject({ url: '/api/plugins/iambenzo-semconvcompliance-app/settings', method: 'POST' });
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
