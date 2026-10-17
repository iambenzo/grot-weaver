import {
  MAX_NAMES_PER_BATCH,
  SERIES_HOURS_PER_QUERY,
  isQueryLimitError,
  planBatches,
  sliceWindow,
} from './queryBudget';

const day = { startSeconds: 0, endSeconds: 86400 };

describe('planBatches', () => {
  it('falls back to fixed-size name batches when series counts are unknown', () => {
    const names = Array.from({ length: MAX_NAMES_PER_BATCH + 1 }, (_, index) => `m${index}`);

    expect(planBatches(names, () => 0, day).map((batch) => batch.names.length)).toEqual([MAX_NAMES_PER_BATCH, 1]);
  });

  it('starts a new batch before the series-hours budget is exceeded', () => {
    const perName = SERIES_HOURS_PER_QUERY / 24 / 2;

    const batches = planBatches(['a', 'b', 'c'], () => perName, day);

    expect(batches.map((batch) => batch.names)).toEqual([['a', 'b'], ['c']]);
    expect(batches.every((batch) => batch.windows.length === 1)).toBe(true);
  });

  it('gives a name over budget its own batch split into enough window slices', () => {
    const batches = planBatches(['light', 'heavy'], (name) => (name === 'heavy' ? SERIES_HOURS_PER_QUERY / 8 : 1), day);

    expect(batches).toEqual([
      { names: ['heavy'], windows: sliceWindow(day, 3) },
      { names: ['light'], windows: [day] },
    ]);
  });
});

describe('sliceWindow', () => {
  it('covers the window with contiguous slices', () => {
    expect(sliceWindow({ startSeconds: 10, endSeconds: 20 }, 3)).toEqual([
      { startSeconds: 10, endSeconds: 13 },
      { startSeconds: 13, endSeconds: 16 },
      { startSeconds: 16, endSeconds: 20 },
    ]);
  });
});

describe('isQueryLimitError', () => {
  it.each([
    ['the query exceeded the maximum number of chunks (limit: 2000000 chunks) (err-mimir-max-chunks-per-query)', true],
    ['the query exceeded the maximum number of series (limit: 100000) (err-mimir-max-series-per-query)', true],
    ['execution: timeout', false],
  ])('%s', (message, expected) => {
    expect(isQueryLimitError(message)).toBe(expected);
  });
});
