import { Owner, ServiceReadinessRow, Signal } from '../api/types';

export interface SignalReadiness {
  present: string[];
  missing: string[];
  unknown: string[];
  missingRecommended: string[];
  share: number | null;
}

export interface ReadinessCounts {
  present: number;
  missing: number;
  unknown: number;
}

export interface ServiceProductReadiness {
  product: string;
  name: string;
  overall: number | null;
  overallCounts: ReadinessCounts;
  signals: Partial<Record<Signal, SignalReadiness>>;
}

export function serviceReadiness(rows: ServiceReadinessRow[], owner: Owner): ServiceProductReadiness[] {
  return rows
    .filter((row) => row.kind === owner.kind && row.name === owner.name)
    .map((row) => ({
      product: row.product,
      name: row.product_name,
      overall: row.overall.value,
      overallCounts: row.signals.reduce(
        (total, signal) => ({
          present: total.present + signal.present.length,
          missing: total.missing + signal.missing.length,
          unknown: total.unknown + signal.unknown.length,
        }),
        { present: 0, missing: 0, unknown: 0 }
      ),
      signals: Object.fromEntries(
        row.signals.map((signal) => [
          signal.signal,
          {
            present: signal.present,
            missing: signal.missing,
            unknown: signal.unknown,
            missingRecommended: signal.missing_recommended,
            share: signal.readiness.value,
          },
        ])
      ),
    }));
}

export function countsOf(readiness: Pick<SignalReadiness, 'present' | 'missing' | 'unknown'>): ReadinessCounts {
  return { present: readiness.present.length, missing: readiness.missing.length, unknown: readiness.unknown.length };
}

export function readinessBasis({ present, missing, unknown }: ReadinessCounts): string {
  const checked = present + missing;
  const parts = checked > 0 ? [`${present} of ${checked} present`] : [];
  if (unknown > 0) {
    parts.push(`${unknown} not checkable`);
  }
  return parts.join(', ');
}
