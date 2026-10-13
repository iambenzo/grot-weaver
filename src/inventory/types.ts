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

export interface MetricDatasource {
  uid: string;
  names: string[];
  target_info: Array<Record<string, string>>;
  owners: MetricOwner[];
}

export type ReclassificationAction = 'exclude' | 'pipeline';

export interface ReclassificationRule {
  pattern: string;
  action: ReclassificationAction;
}

export interface Inventory {
  window: Window;
  traces: TraceDatasource[];
  metrics?: MetricDatasource[];
  reclassification?: ReclassificationRule[];
}

export interface CollectionError {
  datasource: string;
  step: string;
  message: string;
}
