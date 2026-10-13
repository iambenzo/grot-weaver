import { lastValueFrom } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';
import pluginJson from '../plugin.json';
import { Inventory } from '../inventory/types';
import { AssessmentResult } from './types';

export type ScoreInventory = (inventory: Inventory, volumeWeighted: boolean) => Promise<AssessmentResult>;

export const scoreInventory: ScoreInventory = async (inventory, volumeWeighted) => {
  const response = await lastValueFrom(
    getBackendSrv().fetch<AssessmentResult>({
      url: `/api/plugins/${pluginJson.id}/resources/score`,
      method: 'POST',
      data: { inventory, volume_weighted: volumeWeighted },
      showErrorAlert: false,
    })
  );
  return response.data;
};
