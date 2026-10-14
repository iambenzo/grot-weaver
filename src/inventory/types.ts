export interface Window {
  start: number;
  end: number;
}

export interface KeyObservation {
  key: string;
  volume: number;
}

export interface SDK {
  name?: string;
  language?: string;
  version?: string;
  distro?: string;
}

export interface SpanGroupSample {
  group: string;
  sampled: number;
  present: Record<string, number>;
}

export interface TraceService {
  service_name: string;
  service_namespace: string;
  span_count: number;
  resource_keys: KeyObservation[];
  span_keys: KeyObservation[];
  span_groups: SpanGroupSample[];
  sdk: SDK;
}

export interface TraceDatasource {
  uid: string;
  services: TraceService[];
}

export interface MetricOwner {
  metric: string;
  labels: Record<string, string>;
  series: number;
}

export interface OwnerLabelKeys {
  metric: string;
  selector: Record<string, string>;
  keys: string[];
}

export interface MetricDatasource {
  uid: string;
  names: string[];
  target_info: Array<Record<string, string>>;
  owners: MetricOwner[];
  label_keys: OwnerLabelKeys[];
  collectors: Array<Record<string, string>>;
  resource_label_checks?: string[];
  strategy_override?: TranslationStrategy;
}

export type TranslationStrategy =
  | 'UnderscoreEscapingWithSuffixes'
  | 'UnderscoreEscapingWithoutSuffixes'
  | 'NoUTF8EscapingWithSuffixes'
  | 'NoTranslation';

export const TRANSLATION_STRATEGIES: TranslationStrategy[] = [
  'UnderscoreEscapingWithSuffixes',
  'UnderscoreEscapingWithoutSuffixes',
  'NoUTF8EscapingWithSuffixes',
  'NoTranslation',
];

export type ReclassificationAction = 'exclude' | 'pipeline';

export interface ReclassificationRule {
  pattern: string;
  action: ReclassificationAction;
}

export type LogKeysMethod = 'detected_fields' | 'sample';

export interface LogService {
  service_name: string;
  service_namespace: string;
  stream_labels: string[];
  metadata_keys: string[];
  keys_method: LogKeysMethod;
  sampled_lines: number;
  otlp_markers: string[];
  scope_names: string[];
  sdk: SDK;
  volume: number;
}

export interface LogDatasource {
  uid: string;
  labels: string[];
  services: LogService[];
}

export interface Inventory {
  window: Window;
  traces: TraceDatasource[];
  metrics?: MetricDatasource[];
  logs?: LogDatasource[];
  reclassification?: ReclassificationRule[];
  custom_namespaces?: string[];
  pipeline_mappings?: Array<{ match: string; pipeline: string }>;
  required_resource_attributes?: string[];
}

export interface CollectionError {
  datasource: string;
  step: string;
  message: string;
  status?: number;
}
