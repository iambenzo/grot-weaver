export type FindingType =
  | 'conformant'
  | 'deprecated'
  | 'unit_mismatch'
  | 'required_attribute_not_present'
  | 'recommended_attribute_not_present'
  | 'misplaced_attribute'
  | 'not_in_registry'
  | 'custom'
  | 'sdk_default_service_name'
  | 'missing_service_name';

export type Level = '' | 'violation' | 'improvement' | 'information';
export type Bucket = 'stable' | 'release_candidate' | 'experimental' | 'unclassified';
export type Signal = 'metrics' | 'traces' | 'logs';
export type OwnerKind = 'service' | 'pipeline' | 'source' | 'unattributed';
export type RegistrySource = 'core' | 'genai' | 'rename_history';
export type Confidence = 'high' | 'medium' | 'low';
export type Scope = 'all' | 'spans' | 'metrics' | 'resources' | 'logs';

export interface Owner {
  kind: OwnerKind;
  namespace?: string;
  name: string;
}

export interface Finding {
  type: FindingType;
  level?: Level;
  signal: Signal;
  owner: Owner;
  observed: string;
  scope?: Scope;
  matched?: string;
  expected?: string;
  bucket?: Bucket;
  confidence?: Confidence;
  note?: string;
  source?: RegistrySource;
  volume: number;
  pipeline_introduced?: boolean;
  metrics?: string[];
  library?: { name: string; version?: string; evidence: string; confidence: Confidence };
  impact_share: number;
}

export interface Ratio {
  value: number | null;
  numerator: number;
  denominator: number;
}

export interface Scores {
  naming_stable: Ratio;
  naming_release_candidate: Ratio;
  naming_experimental: Ratio;
  requirements: Ratio;
  resource: Ratio;
  required_resource: Ratio;
  deprecated: number;
  unclassified: number;
  custom: number;
}

export interface ScoreRow {
  owner: Owner;
  signal: Signal;
  scores: Scores;
}

export interface Attribution {
  datasource: string;
  owner: Owner;
  source: string;
  confidence: Confidence;
  sdk: { name?: string; language?: string; version?: string; distro?: string };
}

export type Origin = 'sdk' | 'collector_scraped' | 'non_otel';

export interface MetricAttribution {
  datasource: string;
  owner: Owner;
  source: string;
  confidence: Confidence;
  origin: { origin: Origin; confidence: Confidence; reason: string };
  sdk: { name?: string; language?: string; version?: string };
  hints?: Record<string, string>;
}

export interface LogAttribution {
  datasource: string;
  owner: Owner;
  source: string;
  confidence: Confidence;
  keys_method: 'detected_fields' | 'sample';
  otlp: boolean;
  sdk: { name?: string; language?: string; version?: string };
}

export interface ServiceHops {
  owner: Owner;
  candidates: Array<{ pipeline: string; reasons: string[]; score: number }>;
}

export interface DatasourceSummary {
  uid: string;
  signal: Signal;
  strategy?: string;
  overridden?: boolean;
  mixed?: boolean;
  evidence: { escaped: number; utf8: number; suffixed: number; not_suffixed: number };
  unit_checkable: boolean;
}

export type PresenceState = 'present' | 'missing' | 'unknown';

export interface ResourceAttributeCheck {
  owner: Owner;
  signal: Signal;
  attribute: string;
  state: PresenceState;
  evidence: string;
}

export interface SignalReadinessRow {
  signal: Signal;
  readiness: Ratio;
  present: string[];
  missing: string[];
  unknown: string[];
  missing_recommended: string[];
}

export interface ServiceReadinessRow {
  kind: OwnerKind;
  name: string;
  product: string;
  product_name: string;
  overall: Ratio;
  signals: SignalReadinessRow[];
}

export interface AssessmentResult {
  semconv_version: string;
  window: { start: number; end: number };
  findings: Finding[];
  attributions: Attribution[];
  metric_attributions?: MetricAttribution[];
  log_attributions?: LogAttribution[];
  datasources?: DatasourceSummary[];
  hops?: ServiceHops[];
  coverage?: Array<{ signal: Signal; coverage: Ratio; unmeasured?: number }>;
  resource_attributes?: ResourceAttributeCheck[];
  service_readiness?: ServiceReadinessRow[];
  owners: ScoreRow[];
  namespaces: ScoreRow[];
  signals: ScoreRow[];
}
