import { strategyExample, strategyLabel } from './strategyLabels';

describe('strategyLabel', () => {
  it('names each Prometheus translation strategy in plain words and keeps unknown ones as sent', () => {
    expect(strategyLabel('UnderscoreEscapingWithSuffixes')).toBe('underscores, with unit suffixes');
    expect(strategyLabel('NoTranslation')).toBe('names as sent');
    expect(strategyLabel('SomethingNew')).toBe('SomethingNew');
    expect(strategyExample('NoUTF8EscapingWithSuffixes')).toContain('http.server.request.duration_seconds');
    expect(strategyExample('SomethingNew')).toBeUndefined();
  });
});
