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

export interface TraceService {
  service_name: string;
  service_namespace: string;
  span_count: number;
  resource_keys: KeyObservation[];
  span_keys: KeyObservation[];
  sdk: SDK;
}

export interface TraceDatasource {
  uid: string;
  services: TraceService[];
}

export interface Inventory {
  window: Window;
  traces: TraceDatasource[];
}

export interface CollectionError {
  datasource: string;
  step: string;
  message: string;
}
