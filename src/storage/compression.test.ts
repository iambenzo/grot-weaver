import { Blob as NodeBlob } from 'buffer';
import { gunzipSync } from 'zlib';
import { CompressionStream, DecompressionStream } from 'stream/web';
import { TextDecoder as NodeTextDecoder } from 'util';
import { gunzipText, gzipBlob } from './compression';

Object.assign(globalThis, { Blob: NodeBlob, CompressionStream, DecompressionStream, TextDecoder: NodeTextDecoder });

describe('compression', () => {
  const json = JSON.stringify({
    findings: Array.from({ length: 2000 }, (_, index) => ({ observed: `name.${index}` })),
  });

  it('gzips a blob into bytes that gunzip back to the same text', async () => {
    const compressed = await gzipBlob(new Blob([json]));

    expect(compressed.byteLength).toBeLessThan(json.length / 5);
    expect(gunzipSync(Buffer.from(compressed)).toString()).toBe(json);
    expect(await gunzipText(compressed)).toBe(json);
  });

  it('keeps text outside ASCII intact', async () => {
    const text = JSON.stringify({ note: 'Größe … 計測' });

    expect(await gunzipText(await gzipBlob(new Blob([text])))).toBe(text);
  });
});
