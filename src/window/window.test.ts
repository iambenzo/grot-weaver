import { dateTime } from '@grafana/data';
import {
  DEFAULT_WINDOW,
  WINDOW_PRESETS,
  createTimePicker,
  createTimeRange,
  defaultWindowFrom,
  lokiWindowParams,
  prometheusLookback,
  prometheusWindowParams,
  shouldOfferWiden,
  tempoWindowParams,
  toQueryWindow,
} from './window';

const day = 24 * 3600;
const window = { startSeconds: 1_791_800_000, endSeconds: 1_791_800_000 + day };

describe('window presets', () => {
  it('offers 1h, 6h, 24h, 7d and 30d', () => {
    expect(WINDOW_PRESETS.map((preset) => preset.from)).toEqual(['now-1h', 'now-6h', 'now-24h', 'now-7d', 'now-30d']);
  });

  it('defaults to 24h', () => {
    expect(DEFAULT_WINDOW).toBe('now-24h');
    expect(createTimeRange({}).state.from).toBe('now-24h');
  });

  it.each([
    ['now-7d', 'now-7d'],
    ['now-1h', 'now-1h'],
    ['now-90d', 'now-24h'],
    [undefined, 'now-24h'],
  ])('uses the admin default %s only when it is a preset', (configured, expected) => {
    expect(defaultWindowFrom({ defaultWindow: configured })).toBe(expected);
  });

  it('restricts the picker to the presets', () => {
    expect(createTimePicker().state.quickRanges).toEqual(WINDOW_PRESETS);
  });
});

describe('backend window parameters', () => {
  it('converts a time range to whole seconds', () => {
    const range = { from: dateTime(1_000_500), to: dateTime(2_000_200), raw: { from: 'x', to: 'y' } };
    expect(toQueryWindow(range)).toEqual({ startSeconds: 1000, endSeconds: 2001 });
  });

  it('uses seconds for Prometheus and Tempo', () => {
    const expected = { start: String(window.startSeconds), end: String(window.endSeconds) };
    expect(prometheusWindowParams(window)).toEqual(expected);
    expect(tempoWindowParams(window)).toEqual(expected);
  });

  it('uses nanoseconds for Loki without losing precision', () => {
    expect(lokiWindowParams(window)).toEqual({ start: '1791800000000000000', end: '1791886400000000000' });
  });

  it('turns the window into a PromQL range for last_over_time', () => {
    expect(prometheusLookback(window)).toBe('86400s');
  });
});

describe('widen prompt', () => {
  it.each([
    ['empty 24h window', window, 0, true],
    ['sparse 24h window', window, 2, true],
    ['busy 24h window', window, 50, false],
    ['empty 7d window', { startSeconds: 0, endSeconds: 7 * day }, 0, false],
  ])('%s', (_name, queryWindow, observed, expected) => {
    expect(shouldOfferWiden(queryWindow, observed)).toBe(expected);
  });
});
