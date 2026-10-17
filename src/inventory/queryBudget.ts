import { QueryWindow } from '../window/window';

export const SERIES_HOURS_PER_QUERY = 10_000_000;
export const MAX_NAMES_PER_BATCH = 40;
export const MAX_WINDOW_SPLITS = 6;
export const MAX_OWNER_ATTEMPTS_PER_BATCH = 128;

const SECONDS_PER_HOUR = 3600;
const QUERY_LIMIT_ERROR = /err-mimir-max-[a-z-]+-per-query|exceeded the maximum number of/;

export interface Batch {
  names: string[];
  windows: QueryWindow[];
}

export type SeriesOf = (name: string) => number;

export function planBatches(names: string[], seriesOf: SeriesOf, window: QueryWindow): Batch[] {
  const hours = (window.endSeconds - window.startSeconds) / SECONDS_PER_HOUR;
  const batches: Batch[] = [];
  let current: string[] = [];
  let cost = 0;
  const flush = () => {
    if (current.length > 0) {
      batches.push({ names: current, windows: [window] });
    }
    current = [];
    cost = 0;
  };
  for (const name of names) {
    const nameCost = seriesOf(name) * hours;
    if (nameCost > SERIES_HOURS_PER_QUERY) {
      batches.push({ names: [name], windows: sliceWindow(window, Math.ceil(nameCost / SERIES_HOURS_PER_QUERY)) });
      continue;
    }
    if (current.length === MAX_NAMES_PER_BATCH || cost + nameCost > SERIES_HOURS_PER_QUERY) {
      flush();
    }
    current.push(name);
    cost += nameCost;
  }
  flush();
  return batches;
}

export function sliceWindow(window: QueryWindow, parts: number): QueryWindow[] {
  const length = window.endSeconds - window.startSeconds;
  const count = Math.max(1, Math.min(parts, length));
  return Array.from({ length: count }, (_, index) => ({
    startSeconds: window.startSeconds + Math.floor((length * index) / count),
    endSeconds: window.startSeconds + Math.floor((length * (index + 1)) / count),
  }));
}

export function isQueryLimitError(message: string): boolean {
  return QUERY_LIMIT_ERROR.test(message);
}
