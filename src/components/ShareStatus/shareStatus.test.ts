import { formatShare, shareStatus } from './shareStatus';

describe('shareStatus', () => {
  it.each([
    [1, 'complete'],
    [0.99, 'partial'],
    [0.01, 'partial'],
    [0, 'none'],
  ])('rates %p as %s', (share, expected) => {
    expect(shareStatus(share)).toBe(expected);
  });
});

describe('formatShare', () => {
  it.each([
    [1, '100%'],
    [0.9999, '>99%'],
    [0.256, '26%'],
    [0.0001, '<1%'],
    [0, '0%'],
  ])('formats %p as %s', (share, expected) => {
    expect(formatShare(share)).toBe(expected);
  });
});
