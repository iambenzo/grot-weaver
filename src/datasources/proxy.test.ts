import { of } from 'rxjs';
import { discoverDatasources, proxyGet } from './proxy';

const getList = jest.fn();
const fetch = jest.fn();

jest.mock('@grafana/runtime', () => ({
  getDataSourceSrv: () => ({ getList }),
  getBackendSrv: () => ({ fetch }),
}));

describe('discoverDatasources', () => {
  it('asks Grafana for the configured types at runtime', () => {
    getList.mockReturnValue([
      { uid: 'traces-a', type: 'tempo', name: 'Traces A', jsonData: {} },
      { uid: 'grafana', type: 'datasource', name: '-- Grafana --', jsonData: {} },
    ]);

    expect(discoverDatasources(['tempo', 'custom-tempo'])).toEqual([{ uid: 'traces-a', type: 'tempo', name: 'Traces A' }]);
    expect(getList).toHaveBeenCalledWith({ type: ['tempo', 'custom-tempo'] });
  });
});

describe('proxyGet', () => {
  it('calls the datasource proxy as the signed-in user without error toasts', async () => {
    fetch.mockReturnValue(of({ data: { ok: true } }));

    await expect(proxyGet('ds/1', '/api/v2/search/tags', { scope: 'span' }, { 'X-Test': '1' })).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith({
      url: '/api/datasources/proxy/uid/ds%2F1/api/v2/search/tags',
      params: { scope: 'span' },
      headers: { 'X-Test': '1' },
      method: 'GET',
      showErrorAlert: false,
      showSuccessAlert: false,
    });
  });
});
