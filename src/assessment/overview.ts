import { AssessmentResult, Finding, FindingType, Owner, Ratio, ScoreRow, Signal } from '../api/types';
import { ownerKey } from './stackAssessment';

export interface ViolationGroup {
  key: string;
  signal: Signal;
  type: FindingType;
  name: string;
  expected?: string;
  note?: string;
  services: number;
  libraries: string[];
  volume: number;
  impactShare: number;
}

export interface ServiceRow {
  owner: Owner;
  scores: Partial<Record<Signal, ScoreRow['scores']>>;
  worst: number | null;
  violations: number;
  requiredResource: Ratio;
}

export function ratioValue(ratio: Ratio | undefined): number | null {
  return ratio?.value ?? null;
}

export function groupViolations(findings: Finding[]): ViolationGroup[] {
  const groups = new Map<string, ViolationGroup & { owners: Set<string> }>();
  for (const finding of findings) {
    if (finding.level !== 'violation' || finding.owner.kind !== 'service') {
      continue;
    }
    const name = finding.matched ?? finding.observed;
    const key = `${finding.signal}|${finding.type}|${name}|${finding.expected ?? ''}`;
    const group = groups.get(key) ?? {
      key,
      signal: finding.signal,
      type: finding.type,
      name,
      expected: finding.expected,
      note: finding.note,
      services: 0,
      libraries: [],
      volume: 0,
      impactShare: 0,
      owners: new Set<string>(),
    };
    group.owners.add(ownerKey(finding.owner));
    group.volume += finding.volume;
    group.impactShare += finding.impact_share;
    if (finding.library && !group.libraries.includes(finding.library.name)) {
      group.libraries.push(finding.library.name);
    }
    groups.set(key, group);
  }
  return [...groups.values()]
    .map(({ owners, ...group }) => ({ ...group, services: owners.size }))
    .sort((a, b) => b.services - a.services || b.impactShare - a.impactShare || a.name.localeCompare(b.name));
}

export function serviceRows(result: AssessmentResult): ServiceRow[] {
  const rows = new Map<string, ServiceRow>();
  for (const row of result.owners) {
    if (row.owner.kind !== 'service') {
      continue;
    }
    const key = ownerKey(row.owner);
    const existing = rows.get(key) ?? {
      owner: row.owner,
      scores: {},
      worst: null,
      violations: 0,
      requiredResource: { value: null, numerator: 0, denominator: 0 },
    };
    existing.scores[row.signal] = row.scores;
    existing.requiredResource = addRatio(existing.requiredResource, row.scores.required_resource);
    const naming = [row.scores.naming_stable, row.scores.naming_release_candidate, row.scores.naming_experimental]
      .map(ratioValue)
      .filter((value): value is number => value !== null);
    for (const value of naming) {
      existing.worst = existing.worst === null ? value : Math.min(existing.worst, value);
    }
    rows.set(key, existing);
  }
  for (const finding of result.findings) {
    const row = finding.owner.kind === 'service' ? rows.get(ownerKey(finding.owner)) : undefined;
    if (row && finding.level === 'violation') {
      row.violations++;
    }
  }
  return [...rows.values()].sort(
    (a, b) =>
      (a.worst ?? Number.POSITIVE_INFINITY) - (b.worst ?? Number.POSITIVE_INFINITY) ||
      b.violations - a.violations ||
      ownerKey(a.owner).localeCompare(ownerKey(b.owner))
  );
}

function addRatio(total: Ratio, next: Ratio | undefined): Ratio {
  const numerator = total.numerator + (next?.numerator ?? 0);
  const denominator = total.denominator + (next?.denominator ?? 0);
  return { numerator, denominator, value: denominator > 0 ? numerator / denominator : null };
}

export interface OwnerSummary {
  owner: Owner;
  findings: number;
  violations: number;
  detail: string[];
}

export function ownersOfKind(result: AssessmentResult, kind: Owner['kind']): OwnerSummary[] {
  const summaries = new Map<string, OwnerSummary>();
  const summary = (owner: Owner) => {
    const key = ownerKey(owner);
    const existing = summaries.get(key) ?? { owner, findings: 0, violations: 0, detail: [] };
    summaries.set(key, existing);
    return existing;
  };
  for (const finding of result.findings) {
    if (finding.owner.kind !== kind) {
      continue;
    }
    const entry = summary(finding.owner);
    entry.findings++;
    if (finding.level === 'violation') {
      entry.violations++;
    }
  }
  for (const attribution of result.metric_attributions ?? []) {
    if (attribution.owner.kind !== kind) {
      continue;
    }
    const entry = summary(attribution.owner);
    entry.detail.push(`metrics origin: ${attribution.origin.origin.replace('_', '-')} (${attribution.origin.reason})`);
    for (const [hint, value] of Object.entries(attribution.hints ?? {})) {
      entry.detail.push(`${hint}=${value}`);
    }
  }
  return [...summaries.values()].sort(
    (a, b) => b.violations - a.violations || ownerKey(a.owner).localeCompare(ownerKey(b.owner))
  );
}

export function coverageFor(result: AssessmentResult, signal: Signal): Ratio | undefined {
  return result.coverage?.find((row) => row.signal === signal)?.coverage;
}

export function unmeasuredFor(result: AssessmentResult, signal: Signal): number {
  return result.coverage?.find((row) => row.signal === signal)?.unmeasured ?? 0;
}
