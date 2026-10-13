import { MetricDatasource, ReclassificationRule, TRANSLATION_STRATEGIES, TranslationStrategy } from '../inventory/types';

export interface DatasourceTypes {
  metrics: string[];
  logs: string[];
  traces: string[];
}

export interface PluginSettings {
  defaultWindow?: string;
  datasourceTypes?: Partial<DatasourceTypes>;
  concurrency?: number;
  volumeWeighted?: boolean;
  reclassification?: ReclassificationRule[];
  strategyOverrides?: Record<string, TranslationStrategy>;
}

export const DEFAULT_DATASOURCE_TYPES: DatasourceTypes = {
  metrics: ['prometheus'],
  logs: ['loki'],
  traces: ['tempo'],
};

export const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 32;

export function readSettings(jsonData: unknown): PluginSettings {
  if (!jsonData || typeof jsonData !== 'object') {
    return {};
  }
  const raw = jsonData as Record<string, unknown>;
  const settings: PluginSettings = {};
  if (typeof raw.defaultWindow === 'string') {
    settings.defaultWindow = raw.defaultWindow;
  }
  if (raw.datasourceTypes && typeof raw.datasourceTypes === 'object') {
    settings.datasourceTypes = readTypes(raw.datasourceTypes as Record<string, unknown>);
  }
  if (typeof raw.concurrency === 'number') {
    settings.concurrency = raw.concurrency;
  }
  if (typeof raw.volumeWeighted === 'boolean') {
    settings.volumeWeighted = raw.volumeWeighted;
  }
  if (Array.isArray(raw.reclassification) && raw.reclassification.every(isRule)) {
    settings.reclassification = raw.reclassification;
  }
  if (raw.strategyOverrides && typeof raw.strategyOverrides === 'object') {
    settings.strategyOverrides = readOverrides(raw.strategyOverrides as Record<string, unknown>);
  }
  return settings;
}

function readOverrides(raw: Record<string, unknown>): Record<string, TranslationStrategy> {
  const overrides: Record<string, TranslationStrategy> = {};
  for (const [uid, strategy] of Object.entries(raw)) {
    if (TRANSLATION_STRATEGIES.includes(strategy as TranslationStrategy)) {
      overrides[uid] = strategy as TranslationStrategy;
    }
  }
  return overrides;
}

export function withStrategyOverride(datasource: MetricDatasource, settings: PluginSettings): MetricDatasource {
  const override = settings.strategyOverrides?.[datasource.uid];
  return override ? { ...datasource, strategy_override: override } : datasource;
}

function isRule(value: unknown): value is ReclassificationRule {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const rule = value as Record<string, unknown>;
  return typeof rule.pattern === 'string' && (rule.action === 'exclude' || rule.action === 'pipeline');
}

export function isVolumeWeighted(settings: PluginSettings): boolean {
  return settings.volumeWeighted === true;
}

function readTypes(raw: Record<string, unknown>): Partial<DatasourceTypes> {
  const types: Partial<DatasourceTypes> = {};
  for (const signal of ['metrics', 'logs', 'traces'] as const) {
    const value = raw[signal];
    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      types[signal] = value;
    }
  }
  return types;
}

export function datasourceTypesFor(settings: PluginSettings, signal: keyof DatasourceTypes): string[] {
  const configured = settings.datasourceTypes?.[signal];
  return configured && configured.length > 0 ? configured : DEFAULT_DATASOURCE_TYPES[signal];
}

export function concurrencyFrom(settings: PluginSettings): number {
  const configured = settings.concurrency;
  if (!configured || !Number.isInteger(configured) || configured < 1) {
    return DEFAULT_CONCURRENCY;
  }
  return Math.min(configured, MAX_CONCURRENCY);
}
