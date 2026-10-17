import { Observable } from 'rxjs';
import { gunzipSync } from 'zlib';
import { CompressionStream as NodeCompressionStream } from 'stream/web';
import { TextEncoder as NodeTextEncoder } from 'util';
import { gzipJson, scoreInventory, withLists } from './score';
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
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(unsubscribed).toHaveBeenCalled();
    expect(fetch.mock.calls[0][0]).toMatchObject({ method: 'POST', data: { volume_weighted: false } });
  });
});
import { AssessmentResult } from './types';

function bytesOf(blob: Blob): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(Buffer.from(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

describe('gzipJson', () => {
  const globals = globalThis as unknown as Record<string, unknown>;
  const original = { CompressionStream: globals.CompressionStream, TextEncoder: globals.TextEncoder };

  afterEach(() => {
    globals.CompressionStream = original.CompressionStream;
    globals.TextEncoder = original.TextEncoder;
  });

  it('sends plain JSON where the browser cannot compress', async () => {
    globals.CompressionStream = undefined;

    await expect(gzipJson({ a: 1 })).resolves.toBeUndefined();
  });

  it('compresses the JSON body with gzip', async () => {
    globals.CompressionStream = NodeCompressionStream;
    globals.TextEncoder = original.TextEncoder ?? NodeTextEncoder;
    const value = { inventory: { window: { start: 0, end: 1 }, traces: [] }, volume_weighted: true };

    const zipped = await gzipJson(value);

    expect(zipped?.type).toBe('application/json');
    expect(JSON.parse(gunzipSync(await bytesOf(zipped!)).toString())).toEqual(value);
  });
});

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
