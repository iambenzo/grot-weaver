import { DatasourceRef, ProxyGet } from '../datasources/proxy';
import { Limiter } from '../datasources/limiter';
import { collectTempoInventory } from '../inventory/tempo';
import {
  FlaggedKey,
  LibraryEvidence,
  LookupContext,
  lookupLibraries,
  probeTraceQLMetrics,
} from '../inventory/traceLibraries';
import { CollectionError, TraceDatasource } from '../inventory/types';
import { QueryWindow } from '../window/window';
import { ScoreInventory } from '../api/score';
import { namespaceScope } from './explore';
import { FetchSpanGroupRules } from '../api/catalogue';
import { AssessmentResult, Finding, Owner } from '../api/types';

export interface TraceAssessment {
  result: AssessmentResult;
  errors: CollectionError[];
  datasources: DatasourceRef[];
}

export interface Dependencies {
  get: ProxyGet;
  limit: Limiter;
  score: ScoreInventory;
  spanGroupRules: FetchSpanGroupRules;
}

export async function assessTraces(
  datasources: DatasourceRef[],
  window: QueryWindow,
  deps: Dependencies,
  volumeWeighted = false
): Promise<TraceAssessment> {
  const rules = await deps.spanGroupRules().catch(() => []);
  const collections = await Promise.all(
    datasources.map((ds) => collectTempoInventory(ds.uid, deps.get, deps.limit, window, rules))
  );
  const traces: TraceDatasource[] = collections.map((collection) => collection.datasource);
  const errors = collections.flatMap((collection) => collection.errors);
  const result = await deps.score(
    { window: { start: window.startSeconds, end: window.endSeconds }, traces },
    volumeWeighted
  );
  return { result, errors, datasources };
}

export function sameOwner(a: Owner, b: Owner): boolean {
  return a.kind === b.kind && (a.namespace ?? '') === (b.namespace ?? '') && a.name === b.name;
}

export function isFlaggedTraceKey(finding: Finding): boolean {
  return (
    finding.signal === 'traces' &&
    finding.level === 'violation' &&
    finding.observed !== '' &&
    finding.scope !== undefined
  );
}

export function findingKey(finding: Finding): string {
  return `${finding.owner.kind}|${finding.owner.namespace ?? ''}|${finding.owner.name}|${finding.scope ?? ''}|${finding.observed}`;
}

export async function lookupFindingLibraries(
  findings: Finding[],
  datasourceFor: (finding: Finding) => string | undefined,
  window: QueryWindow,
  deps: Pick<Dependencies, 'get' | 'limit'>,
  ownersBeside: (finding: Finding) => Owner[] = () => []
): Promise<Map<string, LibraryEvidence>> {
  const evidence = new Map<string, LibraryEvidence>();
  const metricsByDatasource = new Map<string, Promise<boolean>>();
  const contextFor = (uid: string): LookupContext => ({ uid, get: deps.get, limit: deps.limit, window });

  await Promise.all(
    findings.filter(isFlaggedTraceKey).map(async (finding) => {
      const uid = datasourceFor(finding);
      if (!uid) {
        return;
      }
      if (!metricsByDatasource.has(uid)) {
        metricsByDatasource.set(uid, probeTraceQLMetrics(contextFor(uid)));
      }
      const flagged: FlaggedKey = {
        serviceName: finding.owner.kind === 'unattributed' ? '' : finding.owner.name,
        serviceNamespace:
          finding.owner.kind === 'unattributed' ? undefined : namespaceScope(finding.owner, ownersBeside(finding)),
        key: finding.observed,
        scope: finding.scope === 'resources' ? 'resource' : 'span',
      };
      try {
        evidence.set(
          findingKey(finding),
          await lookupLibraries(contextFor(uid), flagged, await metricsByDatasource.get(uid)!)
        );
      } catch {
        return;
      }
    })
  );
  return evidence;
}
