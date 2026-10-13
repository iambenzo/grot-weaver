import { TimeOption } from '@grafana/data';
import { PluginSettings } from '../settings/settings';

const NOW = 'now';

export const DEFAULT_WINDOW = 'now-24h';
export const WIDENED_WINDOW = 'now-7d';

export const WINDOW_PRESETS: TimeOption[] = [
  { from: 'now-1h', to: NOW, display: 'Last 1 hour' },
  { from: 'now-6h', to: NOW, display: 'Last 6 hours' },
  { from: 'now-24h', to: NOW, display: 'Last 24 hours' },
  { from: 'now-7d', to: NOW, display: 'Last 7 days' },
  { from: 'now-30d', to: NOW, display: 'Last 30 days' },
];

export function defaultWindowFrom(settings: PluginSettings): string {
  const configured = settings.defaultWindow;
  return WINDOW_PRESETS.some((preset) => preset.from === configured) ? (configured as string) : DEFAULT_WINDOW;
}
