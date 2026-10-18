import { shareStatus } from './shareStatus';

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
