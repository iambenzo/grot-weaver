import { TimeRange } from '@grafana/data';
import { SceneTimePicker, SceneTimeRange } from '@grafana/scenes';
import { PluginSettings } from '../settings/settings';
import { WINDOW_PRESETS, defaultWindowFrom } from './presets';

const NOW = 'now';
const NANOSECONDS_PER_SECOND = BigInt(1_000_000_000);
const SPARSE_THRESHOLD = 3;

export interface QueryWindow {
  startSeconds: number;
  endSeconds: number;
}

export function createTimeRange(settings: PluginSettings): SceneTimeRange {
  return new SceneTimeRange({ from: defaultWindowFrom(settings), to: NOW });
}

export function createTimePicker(): SceneTimePicker {
  return new SceneTimePicker({ isOnCanvas: true, quickRanges: WINDOW_PRESETS });
}

export function toQueryWindow(range: TimeRange): QueryWindow {
  return {
    startSeconds: Math.floor(range.from.valueOf() / 1000),
    endSeconds: Math.ceil(range.to.valueOf() / 1000),
  };
}

export function prometheusWindowParams(window: QueryWindow): Record<string, string> {
  return { start: String(window.startSeconds), end: String(window.endSeconds) };
}

export function prometheusLookback(window: QueryWindow): string {
  return `${Math.max(window.endSeconds - window.startSeconds, 1)}s`;
}

export function tempoWindowParams(window: QueryWindow): Record<string, string> {
  return { start: String(window.startSeconds), end: String(window.endSeconds) };
}

export function lokiWindowParams(window: QueryWindow): Record<string, string> {
  return {
    start: (BigInt(window.startSeconds) * NANOSECONDS_PER_SECOND).toString(),
    end: (BigInt(window.endSeconds) * NANOSECONDS_PER_SECOND).toString(),
  };
}

export function shouldOfferWiden(window: QueryWindow, observedItems: number): boolean {
  const sevenDaysSeconds = 7 * 24 * 3600;
  const isShorterThanWidened = window.endSeconds - window.startSeconds < sevenDaysSeconds;
  return isShorterThanWidened && observedItems < SPARSE_THRESHOLD;
}
