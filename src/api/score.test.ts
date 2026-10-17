import { Observable } from 'rxjs';
import { scoreInventory, withLists } from './score';
import { Inventory } from '../inventory/types';

const fetch = jest.fn();

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: () => ({ fetch }),
}));

describe('scoreInventory', () => {
  it('cancels the score request when the signal aborts', async () => {
    const unsubscribed = jest.fn();
    fetch.mockReturnValue(new Observable(() => unsubscribed));
    const controller = new AbortController();

    const pending = scoreInventory({ window: { start: 0, end: 1 }, traces: [] } as Inventory, false, controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(unsubscribed).toHaveBeenCalled();
    expect(fetch.mock.calls[0][0]).toMatchObject({ method: 'POST', data: { volume_weighted: false } });
  });
});
import { AssessmentResult } from './types';

describe('withLists', () => {
  it('turns null lists from the backend into empty lists', () => {
    const fromBackend = {
      semconv_version: 'v1.44.0',
      window: { start: 0, end: 1 },
      findings: null,
      attributions: null,
      owners: null,
      namespaces: null,
      signals: null,
    } as unknown as AssessmentResult;

    const result = withLists(fromBackend);

    expect(result.attributions).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.metric_attributions).toEqual([]);
  });
});
