import { TimeOption, TimeRange } from '@grafana/data';
import { SceneTimePicker, SceneTimeRange } from '@grafana/scenes';
import { PluginSettings } from '../settings/settings';

export const DEFAULT_WINDOW = 'now-24h';
export const WIDENED_WINDOW = 'now-7d';
const NOW = 'now';
const NANOSECONDS_PER_SECOND = BigInt(1_000_000_000);
const SPARSE_THRESHOLD = 3;

export const WINDOW_PRESETS: TimeOption[] = [
  { from: 'now-1h', to: NOW, display: 'Last 1 hour' },
  { from: 'now-6h', to: NOW, display: 'Last 6 hours' },
  { from: 'now-24h', to: NOW, display: 'Last 24 hours' },
  { from: 'now-7d', to: NOW, display: 'Last 7 days' },
  { from: 'now-30d', to: NOW, display: 'Last 30 days' },
];

export interface QueryWindow {
  startSeconds: number;
  endSeconds: number;
}

export function defaultWindowFrom(settings: PluginSettings): string {
  const configured = settings.defaultWindow;
  return WINDOW_PRESETS.some((preset) => preset.from === configured) ? (configured as string) : DEFAULT_WINDOW;
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
