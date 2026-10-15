import { Owner, ProductReadiness, Signal } from '../api/types';
import { sameOwner } from './traceAssessment';

export interface SignalReadiness {
  present: string[];
  missing: string[];
  unknown: string[];
  missingRecommended: string[];
  share: number | null;
}

export interface ServiceProductReadiness {
  product: string;
  name: string;
  overall: number | null;
  signals: Partial<Record<Signal, SignalReadiness>>;
}

export function serviceReadiness(rows: ProductReadiness[], owners: Owner[]): ServiceProductReadiness[] {
  const owned = rows.filter((row) => owners.some((owner) => sameOwner(owner, row.owner)));
  const names = new Map(owned.map((row) => [row.product, row.product_name]));
  return [...names].map(([product, name]) => {
    const signals: Partial<Record<Signal, SignalReadiness>> = {};
    for (const row of owned.filter((candidate) => candidate.product === product)) {
      signals[row.signal] = mergeSignal(signals[row.signal], row);
    }
    return { product, name, signals, overall: overallShare(Object.values(signals)) };
  });
}

function mergeSignal(existing: SignalReadiness | undefined, row: ProductReadiness): SignalReadiness {
  const present = union(existing?.present ?? [], row.present);
  const missing = union(existing?.missing ?? [], row.missing).filter((attribute) => !present.includes(attribute));
  const unknown = union(existing?.unknown ?? [], row.unknown).filter(
    (attribute) => !present.includes(attribute) && !missing.includes(attribute)
  );
  const missingRecommended = existing
    ? existing.missingRecommended.filter((attribute) => row.missing_recommended.includes(attribute))
    : row.missing_recommended;
  return {
    present,
    missing,
    unknown,
    missingRecommended,
    share: shareOf(present.length, missing.length, unknown.length),
  };
}

function overallShare(signals: SignalReadiness[]): number | null {
  const present = signals.reduce((total, signal) => total + signal.present.length, 0);
  const missing = signals.reduce((total, signal) => total + signal.missing.length, 0);
  const unknown = signals.reduce((total, signal) => total + signal.unknown.length, 0);
  return shareOf(present, missing, unknown);
}

function shareOf(present: number, missing: number, unknown: number): number | null {
  if (present + missing === 0 || (missing === 0 && unknown > 0)) {
    return null;
  }
  return present / (present + missing);
}

function union(first: string[], second: string[]): string[] {
  return [...new Set([...first, ...second])];
}
