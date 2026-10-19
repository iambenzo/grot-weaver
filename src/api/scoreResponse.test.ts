import { of, throwError } from 'rxjs';
import { Blob as NodeBlob } from 'buffer';
import { messageOf } from './errors';
import { scoreInventory, scoreResponseOf } from './score';
import { Inventory } from '../inventory/types';

Object.assign(globalThis, { Blob: NodeBlob });

const fetch = jest.fn();

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: () => ({ fetch }),
}));

const inventory = { window: { start: 0, end: 1 }, traces: [] } as Inventory;

describe('scoreInventory response', () => {
  it('asks for the raw body, parses it, and remembers it for the result', async () => {
    const body = new Blob([JSON.stringify({ semconv_version: 'v1.44.0', findings: null, owners: [] })]);
    fetch.mockReturnValue(of({ data: body }));

    const result = await scoreInventory(inventory, false);

    expect(fetch.mock.calls[0][0]).toMatchObject({ responseType: 'blob' });
    expect(result.semconv_version).toBe('v1.44.0');
    expect(result.findings).toEqual([]);
    expect(scoreResponseOf(result)).toBe(body);
  });

  it('keeps the backend error message readable', async () => {
    fetch.mockReturnValue(
      throwError(() => ({
        status: 400,
        data: new Blob([JSON.stringify({ message: 'inventory exceeds 5000 services' })]),
      }))
    );

    const failure = await scoreInventory(inventory, false).catch((error: unknown) => error);

    expect(messageOf(failure)).toBe('inventory exceeds 5000 services');
    expect(failure).toMatchObject({ status: 400 });
  });

  it('keeps the message of an Error whose body is a Blob', async () => {
    const failure = Object.assign(new Error('Bad Gateway'), { status: 502, data: new Blob(['upstream down']) });
    fetch.mockReturnValue(throwError(() => failure));

    const thrown = await scoreInventory(inventory, false).catch((error: unknown) => error);

    expect(thrown).toBe(failure);
    expect(messageOf(thrown)).toBe('Bad Gateway');
    expect(thrown).toMatchObject({ data: 'upstream down' });
  });

  it('passes on a plain-text error body as text', async () => {
    fetch.mockReturnValue(throwError(() => ({ status: 502, data: new Blob(['bad gateway']) })));

    const failure = await scoreInventory(inventory, false).catch((error: unknown) => error);

    expect(failure).toMatchObject({ status: 502, data: 'bad gateway' });
  });
});
