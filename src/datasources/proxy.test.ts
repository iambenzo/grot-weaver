import { Observable, of } from 'rxjs';
import { createProxyGet, discoverDatasources, proxyGet } from './proxy';

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

    expect(discoverDatasources(['tempo', 'custom-tempo'])).toEqual([
      { uid: 'traces-a', type: 'tempo', name: 'Traces A' },
    ]);
    expect(getList).toHaveBeenCalledWith({ type: ['tempo', 'custom-tempo'] });
  });
});

describe('proxyGet', () => {
  it('calls the datasource proxy as the signed-in user without error toasts', async () => {
    fetch.mockReturnValue(of({ data: { ok: true } }));

    await expect(proxyGet('ds/1', '/api/v2/search/tags', { scope: 'span' }, { 'X-Test': '1' })).resolves.toEqual({
      ok: true,
    });
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

describe('createProxyGet', () => {
  it('cancels the request and rejects with an abort error when the signal aborts', async () => {
    const unsubscribed = jest.fn();
    fetch.mockReturnValue(new Observable(() => unsubscribed));
    const controller = new AbortController();

    const pending = createProxyGet(controller.signal)('ds', '/api/v1/labels', {});
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(unsubscribed).toHaveBeenCalled();
  });

  it('removes its abort listener when the response arrives synchronously', async () => {
    fetch.mockReturnValue(of({ data: 'ok' }));
    const controller = new AbortController();
    const added = jest.spyOn(controller.signal, 'addEventListener');
    const removed = jest.spyOn(controller.signal, 'removeEventListener');

    await expect(createProxyGet(controller.signal)('ds', '/api/v1/labels', {})).resolves.toBe('ok');

    expect(removed).toHaveBeenCalledWith('abort', added.mock.calls[0][1]);
    expect(added.mock.invocationCallOrder[0]).toBeLessThan(removed.mock.invocationCallOrder[0]);
  });

  it('resolves with the last response once the request completes', async () => {
    fetch.mockReturnValue(of({ data: 'first' }, { data: 'last' }));

    await expect(createProxyGet()('ds', '/api/v1/labels', {})).resolves.toBe('last');
  });

  it('does not send a request once the signal has aborted', async () => {
    fetch.mockClear();
    const controller = new AbortController();
    controller.abort();

    await expect(createProxyGet(controller.signal)('ds', '/api/v1/labels', {})).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
