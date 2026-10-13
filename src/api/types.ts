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

export interface AssessmentResult {
  semconv_version: string;
  window: { start: number; end: number };
  findings: Finding[];
  attributions: Attribution[];
  owners: ScoreRow[];
  namespaces: ScoreRow[];
  signals: ScoreRow[];
}
