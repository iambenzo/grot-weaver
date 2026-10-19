import { fetchData } from '../datasources/proxy';
import pluginJson from '../plugin.json';
import { Inventory } from '../inventory/types';
import { AssessmentResult } from './types';
import { drain } from '../storage/compression';

export type ScoreInventory = (
  inventory: Inventory,
  volumeWeighted: boolean,
  signal?: AbortSignal
) => Promise<AssessmentResult>;

const responses = new WeakMap<AssessmentResult, Blob>();

export function scoreResponseOf(result: AssessmentResult): Blob | undefined {
  return responses.get(result);
}

export function rememberScoreResponse(result: AssessmentResult, response: Blob): AssessmentResult {
  responses.set(result, response);
  return result;
}

export const scoreInventory: ScoreInventory = async (inventory, volumeWeighted, signal) => {
  const body = { inventory, volume_weighted: volumeWeighted };
  const zipped = await gzipJson(body);
  const response = await fetchData<Blob>(
    {
      url: `/api/plugins/${pluginJson.id}/resources/score`,
      method: 'POST',
      data: zipped ?? body,
      headers: zipped ? { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' } : undefined,
      responseType: 'blob',
      showErrorAlert: false,
    },
    signal
  ).catch(async (error: unknown) => Promise.reject(await withReadableBody(error)));
  return rememberScoreResponse(withLists(JSON.parse(await response.text())), response);
};

async function withReadableBody(error: unknown): Promise<unknown> {
  const data = (error as { data?: unknown } | undefined)?.data;
  if (!(data instanceof Blob)) {
    return error;
  }
  const text = await data.text();
  const failure = error as { data: unknown };
  try {
    failure.data = JSON.parse(text);
  } catch {
    failure.data = text;
  }
  return failure;
}

export async function gzipJson(value: unknown): Promise<Blob | undefined> {
  if (typeof CompressionStream === 'undefined') {
    return undefined;
  }
  const compression = new CompressionStream('gzip');
  const writer = compression.writable.getWriter();
  const written = writer.write(new TextEncoder().encode(JSON.stringify(value))).then(() => writer.close());
  const [chunks] = await Promise.all([drain(compression.readable), written]);
  return new Blob(chunks as BlobPart[], { type: 'application/json' });
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
