import { DatasourceRef, ProxyGet } from '../datasources/proxy';
import { Limiter } from '../datasources/limiter';
import { collectTempoInventory } from '../inventory/tempo';
import { collectPrometheusInventory, LabelProgress, NamesNeedingLabels } from '../inventory/prometheus';
import { collectLokiInventory } from '../inventory/loki';
import { CollectionError, Inventory } from '../inventory/types';
import { QueryWindow } from '../window/window';
import { ScoreInventory } from '../api/score';
import { FetchSpanGroupRules } from '../api/catalogue';
import { AssessmentResult, Owner, Signal } from '../api/types';
import { PluginSettings, withStrategyOverride } from '../settings/settings';

export type DatasourcesBySignal = Record<Signal, DatasourceRef[]>;

export interface StackAssessment {
  result: AssessmentResult;
  errors: CollectionError[];
  datasources: DatasourcesBySignal;
}

export interface StackDependencies {
  get: ProxyGet;
  limit: Limiter;
  score: ScoreInventory;
  spanGroupRules: FetchSpanGroupRules;
  namesNeedingLabels: NamesNeedingLabels;
  onLabelProgress?: (progress: LabelProgress) => void;
}

export async function assessStack(
  datasources: DatasourcesBySignal,
  window: QueryWindow,
  settings: PluginSettings,
  deps: StackDependencies
): Promise<StackAssessment> {
  const rules = await deps.spanGroupRules().catch(() => []);
  const [traces, metrics, logs] = await Promise.all([
    Promise.all(datasources.traces.map((ds) => collectTempoInventory(ds.uid, deps.get, deps.limit, window, rules))),
    Promise.all(
      datasources.metrics.map((ds) =>
        collectPrometheusInventory(ds.uid, deps.get, deps.limit, window, deps.namesNeedingLabels, deps.onLabelProgress)
      )
    ),
    Promise.all(datasources.logs.map((ds) => collectLokiInventory(ds.uid, deps.get, deps.limit, window))),
  ]);
  const inventory: Inventory = {
    window: { start: window.startSeconds, end: window.endSeconds },
    traces: traces.map((collection) => collection.datasource),
    metrics: metrics.map((collection) => withStrategyOverride(collection.datasource, settings)),
    logs: logs.map((collection) => collection.datasource),
  };
  if (settings.reclassification) {
    inventory.reclassification = settings.reclassification;
  }
  const result = await deps.score(inventory, settings.volumeWeighted === true);
  const errors = [...traces, ...metrics, ...logs].flatMap((collection) => collection.errors);
  return { result, errors, datasources };
}

export interface ServiceIdentity {
  owner: Owner;
  signals: Signal[];
  aliases: Owner[];
}

export function ownerKey(owner: Owner): string {
  return `${owner.kind}|${owner.namespace ?? ''}|${owner.name}`;
}

export function mergeOwners(result: AssessmentResult): ServiceIdentity[] {
  const bySignal: Array<[Signal, Owner[]]> = [
    ['traces', result.attributions.map((attribution) => attribution.owner)],
    ['metrics', (result.metric_attributions ?? []).map((attribution) => attribution.owner)],
    ['logs', (result.log_attributions ?? []).map((attribution) => attribution.owner)],
  ];
  const merged = new Map<string, ServiceIdentity>();
  for (const [signal, owners] of bySignal) {
    for (const owner of owners) {
      const key = ownerKey(owner);
      const identity = merged.get(key) ?? { owner, signals: [], aliases: [] };
      if (!identity.signals.includes(signal)) {
        identity.signals.push(signal);
      }
      merged.set(key, identity);
    }
  }
  const identities = [...merged.values()];
  for (const identity of identities) {
    identity.aliases = identities
      .filter(
        (other) =>
          other !== identity && other.owner.name === identity.owner.name && other.owner.kind === identity.owner.kind
      )
      .map((other) => other.owner);
  }
  return identities.sort((a, b) => ownerKey(a.owner).localeCompare(ownerKey(b.owner)));
}
