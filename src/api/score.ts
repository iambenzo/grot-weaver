import { fetchData } from '../datasources/proxy';
import pluginJson from '../plugin.json';
import { Inventory } from '../inventory/types';
import { AssessmentResult } from './types';

export type ScoreInventory = (
  inventory: Inventory,
  volumeWeighted: boolean,
  signal?: AbortSignal
) => Promise<AssessmentResult>;

export const scoreInventory: ScoreInventory = async (inventory, volumeWeighted, signal) => {
  const body = { inventory, volume_weighted: volumeWeighted };
  const zipped = await gzipJson(body);
  return withLists(
    await fetchData<AssessmentResult>(
      {
        url: `/api/plugins/${pluginJson.id}/resources/score`,
        method: 'POST',
        data: zipped ?? body,
        headers: zipped ? { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' } : undefined,
        showErrorAlert: false,
      },
      signal
    )
  );
};

export async function gzipJson(value: unknown): Promise<Blob | undefined> {
  if (typeof CompressionStream === 'undefined') {
    return undefined;
  }
  const compression = new CompressionStream('gzip');
  const writer = compression.writable.getWriter();
  const written = writer.write(new TextEncoder().encode(JSON.stringify(value))).then(() => writer.close());
  const [chunks] = await Promise.all([drain(compression.readable), written]);
  return new Blob(chunks, { type: 'application/json' });
}

async function drain(readable: ReadableStream<Uint8Array>): Promise<BlobPart[]> {
  const chunks: BlobPart[] = [];
  const reader = readable.getReader();
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    chunks.push(new Uint8Array(read.value));
  }
  return chunks;
}

export function withLists(result: AssessmentResult): AssessmentResult {
  return {
    ...result,
    findings: result.findings ?? [],
    attributions: result.attributions ?? [],
    metric_attributions: result.metric_attributions ?? [],
    log_attributions: result.log_attributions ?? [],
    datasources: result.datasources ?? [],
    hops: result.hops ?? [],
    coverage: result.coverage ?? [],
    owners: result.owners ?? [],
    namespaces: result.namespaces ?? [],
    signals: result.signals ?? [],
  };
}
