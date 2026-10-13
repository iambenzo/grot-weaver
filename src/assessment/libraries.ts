import { Finding } from '../api/types';
import { LibraryEvidence } from '../inventory/traceLibraries';
import { findingKey } from './traceAssessment';

export interface LibraryInfo {
  libraries: Array<{ name: string; version?: string }>;
  confidence: 'high' | 'medium' | 'low';
  description: string;
  likely?: boolean;
  firstSeenMs?: number;
  lastSeenMs?: number;
}

export function libraryInfo(
  finding: Finding,
  traceEvidence: Map<string, LibraryEvidence>,
  allFindings: Finding[]
): LibraryInfo | undefined {
  const evidence = traceEvidence.get(findingKey(finding));
  if (evidence) {
    return {
      libraries: evidence.libraries,
      confidence: evidence.confidence,
      description: evidence.method === 'metrics' ? 'from TraceQL metrics' : 'from a span sample',
      firstSeenMs: evidence.firstSeenMs,
      lastSeenMs: evidence.lastSeenMs,
    };
  }
  if (finding.library) {
    return {
      libraries: [{ name: finding.library.name, version: finding.library.version }],
      confidence: finding.library.confidence === 'low' ? 'low' : finding.library.confidence,
      description: `from ${finding.library.evidence}`,
    };
  }
  return likelyLibrary(finding, traceEvidence, allFindings);
}

export function likelyLibrary(
  finding: Finding,
  traceEvidence: Map<string, LibraryEvidence>,
  allFindings: Finding[]
): LibraryInfo | undefined {
  if (finding.signal !== 'metrics' || finding.type !== 'deprecated' || !finding.matched) {
    return undefined;
  }
  const sameOwner = (other: Finding) =>
    other.owner.kind === finding.owner.kind &&
    (other.owner.namespace ?? '') === (finding.owner.namespace ?? '') &&
    other.owner.name === finding.owner.name;
  const traceFinding = allFindings.find(
    (other) => other.signal === 'traces' && sameOwner(other) && other.matched === finding.matched
  );
  const evidence = traceFinding ? traceEvidence.get(findingKey(traceFinding)) : undefined;
  if (!evidence || evidence.libraries.length === 0) {
    return undefined;
  }
  return {
    libraries: evidence.libraries,
    confidence: evidence.confidence === 'high' ? 'medium' : 'low',
    description: `likely: the same service's traces show this library sending ${finding.matched}`,
    likely: true,
  };
}
