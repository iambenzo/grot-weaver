import { Finding, Owner, ScoreRow, Signal } from '../api/types';
import {
  coverageFor,
  groupViolations,
  serviceRows,
  uncheckableResourceFor,
  unmeasuredFor,
} from '../assessment/overview';
import { DatasourceProgress, StackAssessment } from '../assessment/stackAssessment';
import { sameOwner } from '../assessment/traceAssessment';
import { formatShare } from '../components/ShareStatus/shareStatus';
import { incompleteReasons, scanLimits, scanSummary } from '../components/StackStatus/StackStatus';
import { findingLine } from '../fix/summary';
import { scoreTiles } from '../pages/Overview/ScoreTiles';
import { ownerName } from '../utils/serviceLink';

export const MAX_CONTEXT_VIOLATIONS = 20;
export const MAX_CONTEXT_SERVICES = 10;
export const MAX_CONTEXT_FINDINGS = 20;
export const MAX_CONTEXT_LIST = 3;
export const MAX_CONTEXT_LIMITS = 10;
export const MAX_CONTEXT_TEXT = 300;
export const MAX_CONTEXT_NAME = 100;

const SIGNALS: Signal[] = ['metrics', 'traces', 'logs'];
const ABOUT =
  'GROT Weaver is a Grafana app that reads the metric names and attribute and label keys in this stack and scores them against the OpenTelemetry semantic conventions. Scores are shares of names or checks that pass; N/A means there was nothing to score. Findings are violations (must fix), improvements or information.';

export interface PageScan {
  assessment: StackAssessment;
  progress: DatasourceProgress[];
  savedAtMs?: number;
  scanning: boolean;
}

interface Capped<T> {
  shown: number;
  total: number;
  items: T[];
}

export function overviewContextData(scan: PageScan, timeRange: string, volumeWeighted: boolean) {
  const { result } = scan.assessment;
  const groups = groupViolations(result.findings);
  const services = serviceRows(result);
  return {
    page: 'GROT Weaver overview',
    about: ABOUT,
    ...common(scan, timeRange, volumeWeighted),
    scores: Object.fromEntries(
      SIGNALS.map((signal) => [
        signal,
        tilesOf({
          signal,
          row: result.signals.find((row) => row.signal === signal),
          coverage: coverageFor(result, signal),
          unmeasured: unmeasuredFor(result, signal),
          uncheckable: uncheckableResourceFor(result, signal),
          volumeWeighted,
        }),
      ])
    ),
    topViolations: capped(groups, MAX_CONTEXT_VIOLATIONS, (group) => ({
      finding: clip(
        findingLine({ type: group.type, signal: group.signal, observed: group.name, expected: group.expected })
      ),
      ...(group.observed.some((name) => name !== group.name)
        ? { sentAs: listed(group.observed, MAX_CONTEXT_LIST) }
        : {}),
      services: group.services,
      libraries: listed(group.libraries, MAX_CONTEXT_LIST),
    })),
    servicesWorstFirst: capped(services, MAX_CONTEXT_SERVICES, (row) => ({
      service: clip(ownerName(row.owner), MAX_CONTEXT_NAME),
      lowestNamingScore: row.worst === null ? 'N/A' : formatShare(row.worst),
      violations: row.violations,
    })),
  };
}

export function serviceContextData(
  scan: PageScan,
  owner: Owner,
  timeRange: string,
  volumeWeighted: boolean,
  quickView: boolean
) {
  const { result } = scan.assessment;
  const findings = result.findings
    .filter((finding) => sameOwner(finding.owner, owner) && finding.type !== 'conformant')
    .sort((a, b) => b.impact_share - a.impact_share);
  return {
    page: 'GROT Weaver service page',
    about: ABOUT,
    service: clip(ownerName(owner), MAX_CONTEXT_NAME),
    ...common(scan, timeRange, volumeWeighted),
    ...(quickView
      ? { quickView: 'Only this service has been scanned so far; stack-wide labels and impact can change.' }
      : {}),
    scores: Object.fromEntries(
      result.owners
        .filter((row) => sameOwner(row.owner, owner))
        .map((row) => [row.signal, serviceTiles(row, volumeWeighted)])
    ),
    findings: capped(findings, MAX_CONTEXT_FINDINGS, findingItem),
  };
}

function common(scan: PageScan, timeRange: string, volumeWeighted: boolean) {
  const { assessment, progress, savedAtMs, scanning } = scan;
  const shownProgress = assessment.progress;
  const limits = scanLimits(shownProgress, assessment.result);
  const pending = shownProgress.some((entry) => entry.state === 'pending');
  return {
    semconvVersion: assessment.result.semconv_version,
    timeRange,
    counting: volumeWeighted ? 'weighted by volume' : 'each name counts once per service',
    scoreMeanings: scoreMeanings(volumeWeighted),
    scan: {
      status: scanSummary({ progress, partial: assessment.partial, savedAtMs, scanning }),
      scoresFinal: savedAtMs !== undefined || (!scanning && !assessment.partial && !pending),
      freshScanRunning: scanning,
      limitedChecks: listed(
        limits.map((limit) => limit.detail),
        MAX_CONTEXT_LIMITS,
        MAX_CONTEXT_TEXT
      ),
      basedOnLimitedData: Object.fromEntries(
        SIGNALS.map((signal) => [signal, incompleteReasons(shownProgress, limits, signal)] as const)
          .filter(([, reasons]) => reasons.length > 0)
          .map(([signal, reasons]) => [signal, listed(reasons, MAX_CONTEXT_LIMITS)])
      ),
    },
  };
}

function tilesOf(props: Parameters<typeof scoreTiles>[0]) {
  return scoreTiles(props).map(({ label, value, basis }) => ({ label, value, basis }));
}

function scoreMeanings(volumeWeighted: boolean): Record<string, string> {
  return Object.fromEntries(scoreTiles({ signal: 'metrics', volumeWeighted }).map(({ label, help }) => [label, help]));
}

function serviceTiles(row: ScoreRow, volumeWeighted: boolean) {
  return tilesOf({ signal: row.signal, row, volumeWeighted }).filter((tile) => tile.label !== 'Coverage');
}

function findingItem(finding: Finding) {
  return {
    level: finding.level || 'information',
    finding: clip(findingLine(finding)),
    impact: formatShare(finding.impact_share),
    ...(finding.library
      ? { library: clip([finding.library.name, finding.library.version].filter(Boolean).join(' '), MAX_CONTEXT_NAME) }
      : {}),
    ...(finding.note ? { note: clip(finding.note) } : {}),
  };
}

function listed(items: string[], max: number, textMax = MAX_CONTEXT_NAME): Capped<string> {
  return capped(items, max, (item) => clip(item, textMax));
}

function clip(text: string, max = MAX_CONTEXT_TEXT): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function capped<T, R>(items: T[], max: number, map: (item: T) => R): Capped<R> {
  const shown = items.slice(0, max).map(map);
  return { shown: shown.length, total: items.length, items: shown };
}
