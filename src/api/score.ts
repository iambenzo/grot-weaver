import { fetchData } from '../datasources/proxy';
import pluginJson from '../plugin.json';
import { Inventory } from '../inventory/types';
import { AssessmentResult } from './types';

export type ScoreInventory = (
  inventory: Inventory,
  volumeWeighted: boolean,
  signal?: AbortSignal
) => Promise<AssessmentResult>;

export const scoreInventory: ScoreInventory = async (inventory, volumeWeighted, signal) =>
  withLists(
    await fetchData<AssessmentResult>(
      {
        url: `/api/plugins/${pluginJson.id}/resources/score`,
        method: 'POST',
        data: { inventory, volume_weighted: volumeWeighted },
        showErrorAlert: false,
      },
      signal
    )
  );

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
