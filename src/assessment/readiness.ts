import { Owner, ServiceReadinessRow, Signal } from '../api/types';

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

export function serviceReadiness(rows: ServiceReadinessRow[], owner: Owner): ServiceProductReadiness[] {
  return rows
    .filter((row) => row.kind === owner.kind && row.name === owner.name)
    .map((row) => ({
      product: row.product,
      name: row.product_name,
      overall: row.overall.value,
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
