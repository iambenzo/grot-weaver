import { lastValueFrom } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';
import pluginJson from '../plugin.json';

export interface SpanGroupRule {
  id: string;
  span_kind: string;
  identifying: string;
  required: string[];
  recommended: string[];
  stability: string;
}

export type FetchSpanGroupRules = () => Promise<SpanGroupRule[]>;

export const fetchSpanGroupRules: FetchSpanGroupRules = async () => {
  const response = await lastValueFrom(
    getBackendSrv().fetch<SpanGroupRule[]>({
      url: `/api/plugins/${pluginJson.id}/resources/catalogue/span-groups`,
      method: 'GET',
      showErrorAlert: false,
    })
  );
  return response.data;
};

export type FetchMetricsNeedingLabels = (names: string[]) => Promise<string[]>;

export const fetchMetricsNeedingLabels: FetchMetricsNeedingLabels = async (names) => {
  const response = await lastValueFrom(
    getBackendSrv().fetch<{ needs_labels: string[] }>({
      url: `/api/plugins/${pluginJson.id}/resources/catalogue/metric-matches`,
      method: 'POST',
      data: { names },
      showErrorAlert: false,
    })
  );
  return response.data.needs_labels;
};
