import { DatasourceRef, ProxyGet, discoverDatasources } from '../datasources/proxy';
import { Limiter } from '../datasources/limiter';
import { VolumeMethod, collectTempoInventory } from '../inventory/tempo';
import { KeysMethod } from '../inventory/traceKeys';
import { collectPrometheusInventory, LabelProgress, NamesNeedingLabels } from '../inventory/prometheus';
import { collectLokiInventory } from '../inventory/loki';
import { CollectionError, Inventory, LogDatasource, MetricDatasource, TraceDatasource } from '../inventory/types';
import { isPermissionDenied } from '../inventory/guard';
import { QueryWindow } from '../window/window';
import { ScoreInventory } from '../api/score';
import { FetchSpanGroupRules, SpanGroupRule } from '../api/catalogue';
import { AssessmentResult, Owner, Signal } from '../api/types';
import {
  DEFAULT_LOG_SAMPLE_LIMIT,
  DEFAULT_TRACE_SAMPLE_LIMIT,
  PluginSettings,
  datasourceTypesFor,
  isExcluded,
  sampleLimit,
  withStrategyOverride,
} from '../settings/settings';

export type DatasourcesBySignal = Record<Signal, DatasourceRef[]>;

export type DatasourceState = 'pending' | 'ok' | 'errors' | 'not_visible';

export interface DatasourceProgress {
  ref: DatasourceRef;
  signal: Signal;
  state: DatasourceState;
  errors: CollectionError[];
  volumeMethod?: VolumeMethod;
  keysMethod?: KeysMethod;
}

export interface Collection {
  ref: DatasourceRef;
  signal: Signal;
  errors: CollectionError[];
  traces?: TraceDatasource;
  metrics?: MetricDatasource;
  logs?: LogDatasource;
  volumeMethod?: VolumeMethod;
  keysMethod?: KeysMethod;
}

export interface StackAssessment {
  result: AssessmentResult;
  errors: CollectionError[];
  datasources: DatasourcesBySignal;
  collections: Collection[];
  progress: DatasourceProgress[];
  partial: boolean;
}

export interface StackDependencies {
  get: ProxyGet;
  limit: Limiter;
  score: ScoreInventory;
  spanGroupRules: FetchSpanGroupRules;
  namesNeedingLabels: NamesNeedingLabels;
  onLabelProgress?: (progress: LabelProgress) => void;
  onProgress?: (progress: DatasourceProgress[]) => void;
  onPartial?: (assessment: StackAssessment) => void;
}

interface Target {
  ref: DatasourceRef;
  signal: Signal;
}

const SIGNALS: Signal[] = ['metrics', 'traces', 'logs'];

export function assessStack(
  datasources: DatasourcesBySignal,
  window: QueryWindow,
  settings: PluginSettings,
  deps: StackDependencies
): Promise<StackAssessment> {
  return runAssessment(datasources, targetsOf(datasources), [], window, settings, deps);
}

export function retryDatasource(
  previous: StackAssessment,
  uid: string,
  window: QueryWindow,
  settings: PluginSettings,
  deps: StackDependencies
): Promise<StackAssessment> {
  const targets = targetsOf(previous.datasources).filter((target) => target.ref.uid === uid);
  const kept = previous.collections.filter((collection) => collection.ref.uid !== uid);
  return runAssessment(previous.datasources, targets, kept, window, settings, deps);
}

export function stateOf(collection: Collection): DatasourceState {
  if (collection.errors.some(isPermissionDenied)) {
    return 'not_visible';
  }
  return collection.errors.length > 0 ? 'errors' : 'ok';
}

async function runAssessment(
  datasources: DatasourcesBySignal,
  targets: Target[],
  seed: Collection[],
  window: QueryWindow,
  settings: PluginSettings,
  deps: StackDependencies
): Promise<StackAssessment> {
  const rules = await deps.spanGroupRules().catch(() => []);
  const collections = [...seed];
  let finished = false;
  const snapshot = () => progressOf(datasources, collections);
  const scoreCollected = async (partial: boolean): Promise<StackAssessment> => {
    const ordered = orderLike(datasources, collections);
    const result = await deps.score(buildInventory(ordered, window, settings), settings.volumeWeighted === true);
    const errors = ordered.flatMap((collection) => collection.errors);
    return { result, errors, datasources, collections: ordered, progress: progressOf(datasources, ordered), partial };
  };
  deps.onProgress?.(snapshot());
  await Promise.all(
    targets.map(async (target) => {
      collections.push(await collect(target, window, settings, deps, rules));
      deps.onProgress?.(snapshot());
      if (finished || collections.length === targetsOf(datasources).length || !deps.onPartial) {
        return;
      }
      const partial = await scoreCollected(true).catch(() => undefined);
      if (partial && !finished) {
        deps.onPartial(partial);
      }
    })
  );
  const assessment = await scoreCollected(false);
  finished = true;
  return assessment;
}

async function collect(
  target: Target,
  window: QueryWindow,
  settings: PluginSettings,
  deps: StackDependencies,
  rules: SpanGroupRule[]
): Promise<Collection> {
  const { ref, signal } = target;
  if (signal === 'traces') {
    const limit = sampleLimit(settings.traceSampleLimit, DEFAULT_TRACE_SAMPLE_LIMIT);
    const collected = await collectTempoInventory(ref.uid, deps.get, deps.limit, window, rules, limit);
    return {
      ref,
      signal,
      errors: collected.errors,
      traces: collected.datasource,
      volumeMethod: collected.volumeMethod,
      keysMethod: collected.keysMethod,
    };
  }
  if (signal === 'metrics') {
    const collected = await collectPrometheusInventory(
      ref.uid,
      deps.get,
      deps.limit,
      window,
      deps.namesNeedingLabels,
      deps.onLabelProgress
    );
    return { ref, signal, errors: collected.errors, metrics: withStrategyOverride(collected.datasource, settings) };
  }
  const limit = sampleLimit(settings.logSampleLimit, DEFAULT_LOG_SAMPLE_LIMIT);
  const collected = await collectLokiInventory(ref.uid, deps.get, deps.limit, window, limit);
  return { ref, signal, errors: collected.errors, logs: collected.datasource };
}

function buildInventory(collections: Collection[], window: QueryWindow, settings: PluginSettings): Inventory {
  const inventory: Inventory = {
    window: { start: window.startSeconds, end: window.endSeconds },
    traces: collections.flatMap((collection) => (collection.traces ? [collection.traces] : [])),
    metrics: collections.flatMap((collection) => (collection.metrics ? [collection.metrics] : [])),
    logs: collections.flatMap((collection) => (collection.logs ? [collection.logs] : [])),
  };
  if (settings.reclassification) {
    inventory.reclassification = settings.reclassification;
  }
  if (settings.customNamespaces && settings.customNamespaces.length > 0) {
    inventory.custom_namespaces = settings.customNamespaces;
  }
  if (settings.requiredResourceAttributes) {
    inventory.required_resource_attributes = settings.requiredResourceAttributes;
  }
  const mappings = (settings.pipelineMappings ?? []).filter((mapping) => mapping.match && mapping.pipeline);
  if (mappings.length > 0) {
    inventory.pipeline_mappings = mappings;
  }
  return inventory;
}

function targetsOf(datasources: DatasourcesBySignal): Target[] {
  return SIGNALS.flatMap((signal) => datasources[signal].map((ref) => ({ ref, signal })));
}

function orderLike(datasources: DatasourcesBySignal, collections: Collection[]): Collection[] {
  return targetsOf(datasources).flatMap((target) =>
    collections.filter((collection) => collection.ref.uid === target.ref.uid && collection.signal === target.signal)
  );
}

function progressOf(datasources: DatasourcesBySignal, collections: Collection[]): DatasourceProgress[] {
  return targetsOf(datasources).map((target) => {
    const collection = collections.find(
      (candidate) => candidate.ref.uid === target.ref.uid && candidate.signal === target.signal
    );
    if (!collection) {
      return { ...target, state: 'pending', errors: [] };
    }
    return {
      ...target,
      state: stateOf(collection),
      errors: collection.errors,
      volumeMethod: collection.volumeMethod,
      keysMethod: collection.keysMethod,
    };
  });
}

export function discoverStack(settings: PluginSettings): DatasourcesBySignal {
  const discover = (signal: Signal) =>
    discoverDatasources(datasourceTypesFor(settings, signal)).filter((ds) => !isExcluded(settings, ds.uid));
  return { metrics: discover('metrics'), traces: discover('traces'), logs: discover('logs') };
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
