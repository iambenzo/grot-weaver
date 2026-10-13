import { lastValueFrom } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';
import pluginJson from '../plugin.json';
import { Finding } from '../api/types';
import { LibraryInfo } from '../assessment/libraries';

export interface PipelineRule {
  available: boolean;
  reason?: string;
  label?: string;
  collector?: string;
  alloy?: string;
}

export interface FixLibrary {
  name: string;
  version?: string;
}

export interface OptIn {
  variable: string;
  value: string;
  note: string;
  sources: string[];
}

export interface InstrumentationGuidance {
  library?: FixLibrary;
  expected?: string;
  docs_url?: string;
  opt_in?: OptIn;
}

export interface FixOptions {
  pipeline_rule: PipelineRule;
  guidance: InstrumentationGuidance;
}

export type FetchFixOptions = (finding: Finding, library?: FixLibrary) => Promise<FixOptions>;

export const fetchFixOptions: FetchFixOptions = async (finding, library) => {
  const response = await lastValueFrom(
    getBackendSrv().fetch<FixOptions>({
      url: `/api/plugins/${pluginJson.id}/resources/fix-snippet`,
      method: 'POST',
      data: library ? { finding, library } : { finding },
      showErrorAlert: false,
    })
  );
  return response.data;
};

export function identifiedLibrary(finding: Finding, library?: LibraryInfo): FixLibrary | undefined {
  const first = library?.libraries.find((entry) => entry.name);
  if (first) {
    return { name: first.name, version: first.version || undefined };
  }
  return finding.library ? { name: finding.library.name, version: finding.library.version } : undefined;
}
