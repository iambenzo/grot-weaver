import { ProxyGet } from '../datasources/proxy';
import { createLimiter } from '../datasources/limiter';
import { allowedRangeOf, queryMetricsRange, sliceStepFor, sliceWindow, spanTotal } from './traceqlMetrics';

const capped = { status: 400, data: 'metrics query time range exceeds the maximum allowed duration of 3h0m0s' };
const tooMuchData = {
  status: 400,
  data: 'metrics query time range of 2h24m0s reads too much data, the allowed range for tenant single-tenant is 1h0m0s',
};
const label = (service: string) => [{ key: 'resource.service.name', value: { stringValue: service } }];
type Rejection = (start: number, end: number, step: number) => unknown;

function alignedRange(start: number, end: number, step: number): [number, number] {
  const alignedEnd = end % step === 0 ? end : end - (end % step) + step;
  const alignedStart = start - (start % step);
  return [alignedStart > step ? alignedStart - step : alignedStart, alignedEnd];
}

const capAfterAlignment =
  (maxSeconds: number): Rejection =>
  (start, end, step) => {
    const [alignedStart, alignedEnd] = alignedRange(start, end, step);
    return alignedEnd - alignedStart > maxSeconds ? capped : undefined;
  };

function alignedBucketEnds(start: number, end: number, step: number): number[] {
  const [alignedStart, alignedEnd] = alignedRange(start, end, step);
  const ends: number[] = [];
  for (let bucketEnd = alignedStart + step; bucketEnd <= alignedEnd; bucketEnd += step) {
    ends.push(bucketEnd);
  }
  return ends;
}

function fakeTempo(spanSeconds: number[], rejection: Rejection) {
  const calls: Array<Record<string, string>> = [];
  const get = (async (_uid: string, _path: string, params: Record<string, string>) => {
    calls.push(params);
    const start = Number(params.start);
    const end = Number(params.end);
    const step = parseInt(params.step, 10);
    const rejected = rejection(start, end, step);
    if (rejected) {
      throw rejected;
    }
    const samples = alignedBucketEnds(start, end, step).map((bucketEnd) => ({
      timestampMs: String(bucketEnd * 1000),
      value: spanSeconds.filter((span) => span > bucketEnd - step && span <= bucketEnd).length,
    }));
    return { series: [{ labels: label('checkout'), samples }] };
  }) as ProxyGet;
  return { get, calls };
}

const cappedTempo = (maxSeconds: number, spanSeconds: number[] = [1]) =>
  fakeTempo(spanSeconds, capAfterAlignment(maxSeconds));
const busyMorning =
  (allowedSeconds: number): Rejection =>
  (start, end, step) =>
    capAfterAlignment(3 * 3600)(start, end, step) ??
    (start < 21600 && end - start > allowedSeconds
      ? { status: 400, data: tooMuchData.data.replace('1h0m0s', `${allowedSeconds}s`) }
      : undefined);
const totalOf = (series: Array<{ samples?: Array<{ value?: number }> }>) =>
  series.reduce((total, entry) => total + spanTotal(entry), 0);

describe('queryMetricsRange', () => {
  it('uses one query when the window fits', async () => {
    const { get, calls } = cappedTempo(3 * 3600);
    const window = { startSeconds: 0, endSeconds: 3600 };

    const series = await queryMetricsRange({ uid: 'tempo', get, limit: createLimiter(2), window }, '{ }');

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ q: '{ }', step: '180s', start: '0', end: '3600' });
    expect(totalOf(series)).toBe(1);
  });

  it('splits the window at the advertised maximum and merges series by labels', async () => {
    const { get, calls } = cappedTempo(3 * 3600);
    const window = { startSeconds: 0, endSeconds: 24 * 3600 };

    const series = await queryMetricsRange({ uid: 'tempo', get, limit: createLimiter(2), window }, '{ }');

    expect(calls).toHaveLength(11);
    expect(calls[1]).toMatchObject({ start: '0', end: '9180', step: '540s' });
    expect(series).toHaveLength(1);
  });

  it('counts each span once when slices meet on a bucket boundary', async () => {
    const spans = [1, 2160, 8640, 8641, 17280, 50000, 86399];
    const { get } = cappedTempo(3 * 3600, spans);
    const window = { startSeconds: 0, endSeconds: 24 * 3600 };

    const series = await queryMetricsRange({ uid: 'tempo', get, limit: createLimiter(2), window }, '{ }');

    expect(totalOf(series)).toBe(spans.length);
  });

  it('counts each span once when the window does not start on a step', async () => {
    const spans = [1000, 8640, 9000, 40000, 87000];
    const { get } = cappedTempo(3 * 3600, spans);
    const window = { startSeconds: 777, endSeconds: 777 + 24 * 3600 };

    const series = await queryMetricsRange({ uid: 'tempo', get, limit: createLimiter(2), window }, '{ }');

    expect(totalOf(series)).toBe(spans.length);
  });

  it('splits a slice again when Tempo says it reads too much data', async () => {
    const spans = [1, 4000, 8640, 12000, 30000, 86399];
    const { get } = fakeTempo(spans, busyMorning(3600));
    const window = { startSeconds: 0, endSeconds: 24 * 3600 };

    const series = await queryMetricsRange({ uid: 'tempo', get, limit: createLimiter(2), window }, '{ }');

    expect(totalOf(series)).toBe(spans.length);
  });

  it('uses a finer step when a re-split slice needs one', async () => {
    const spans = [1, 300, 599, 600, 4000, 8640, 12000, 30000, 86399];
    const { get } = fakeTempo(spans, busyMorning(600));
    const window = { startSeconds: 0, endSeconds: 24 * 3600 };

    const series = await queryMetricsRange({ uid: 'tempo', get, limit: createLimiter(4), window }, '{ }');

    expect(totalOf(series)).toBe(spans.length);
  });

  it('splits a window that only exceeds the maximum once Tempo aligns it', async () => {
    const spans = [86500, 90000, 97200];
    const { get, calls } = cappedTempo(3 * 3600, spans);
    const window = { startSeconds: 86400, endSeconds: 97200 };

    const series = await queryMetricsRange({ uid: 'tempo', get, limit: createLimiter(2), window }, '{ }');

    expect(calls.length).toBeGreaterThan(1);
    expect(totalOf(series)).toBe(spans.length);
  });

  it('splits by the smallest allowance when several tenants reject the range', async () => {
    const joined = { status: 400, data: `${capped.data}\n${capped.data.replace('3h0m0s', '1h0m0s')}` };
    const { get, calls } = fakeTempo([1], (start, end, step) => {
      const [alignedStart, alignedEnd] = alignedRange(start, end, step);
      return alignedEnd - alignedStart > 3600 ? joined : undefined;
    });
    const window = { startSeconds: 0, endSeconds: 6 * 3600 };

    await queryMetricsRange({ uid: 'tempo', get, limit: createLimiter(2), window }, '{ }', 12);

    expect(calls.slice(1).every((call) => Number(call.end) - Number(call.start) < 3600)).toBe(true);
  });

  it('gives up when a split cannot shrink the slice', async () => {
    const stubborn: Rejection = (start, end, step) => capAfterAlignment(3 * 3600)(start, end, step) ?? tooMuchData;
    const { get } = fakeTempo([1], stubborn);
    const window = { startSeconds: 0, endSeconds: 24 * 3600 };

    await expect(
      queryMetricsRange({ uid: 'tempo', get, limit: createLimiter(2), window }, '{ }')
    ).rejects.toBeDefined();
  });

  it('counts re-split slices against the slice budget', async () => {
    const { get } = fakeTempo([1], busyMorning(3600));
    const window = { startSeconds: 0, endSeconds: 24 * 3600 };

    await expect(
      queryMetricsRange({ uid: 'tempo', get, limit: createLimiter(2), window }, '{ }', 12)
    ).rejects.toMatchObject({ data: expect.stringContaining('reads too much data') });
  });

  it('rethrows when slicing would exceed the slice budget', async () => {
    const { get } = cappedTempo(3 * 3600);
    const window = { startSeconds: 0, endSeconds: 7 * 24 * 3600 };

    await expect(queryMetricsRange({ uid: 'tempo', get, limit: createLimiter(2), window }, '{ }', 8)).rejects.toBe(
      capped
    );
  });

  it('rethrows errors that are not a duration limit', async () => {
    const failure = { status: 500, data: { message: 'empty ring' } };
    const get = (async () => {
      throw failure;
    }) as ProxyGet;
    const window = { startSeconds: 0, endSeconds: 3600 };

    await expect(queryMetricsRange({ uid: 'tempo', get, limit: createLimiter(2), window }, '{ }')).rejects.toBe(
      failure
    );
  });
});

describe('allowedRangeOf', () => {
  it.each([
    [capped, 10800],
    [tooMuchData, 3600],
    [{ message: `${capped.data}\n${tooMuchData.data}` }, 3600],
    [{ data: `${tooMuchData.data}\n${tooMuchData.data.replace('1h0m0s', '20m0s')}` }, 1200],
    [{ data: { message: 'exceeds the maximum allowed duration of 1h30m0s' } }, 5400],
    [{ message: 'exceeds the maximum allowed duration of 168h0m0s' }, 604800],
    [{ data: { message: 'empty ring' } }, undefined],
    ['boom', undefined],
  ])('reads %p as %p seconds', (error, expected) => {
    expect(allowedRangeOf(error)).toBe(expected);
  });
});

describe('sliceWindow', () => {
  it('leaves headroom below the maximum, covers the window and trims the last slice', () => {
    expect(sliceWindow({ startSeconds: 0, endSeconds: 6000 }, 3000, 300)).toEqual([
      { startSeconds: 0, endSeconds: 2100 },
      { startSeconds: 2100, endSeconds: 4200 },
      { startSeconds: 4200, endSeconds: 6000 },
    ]);
  });

  it('puts every inner boundary on a multiple of the step', () => {
    expect(sliceWindow({ startSeconds: 700, endSeconds: 6000 }, 3000, 300)).toEqual([
      { startSeconds: 700, endSeconds: 2700 },
      { startSeconds: 2700, endSeconds: 4800 },
      { startSeconds: 4800, endSeconds: 6000 },
    ]);
  });

  it('keeps each slice within a thousand buckets', () => {
    const slices = sliceWindow({ startSeconds: 0, endSeconds: 5000 }, 10100, 1);
    expect(slices.every((slice) => slice.endSeconds - slice.startSeconds <= 1000)).toBe(true);
    expect(slices).toHaveLength(5);
  });

  it('cannot slice below one step', () => {
    expect(sliceWindow({ startSeconds: 0, endSeconds: 6000 }, 2000, 600)).toEqual([]);
  });
});

describe('sliceStepFor', () => {
  it('rounds to whole minutes and refines only by dividing the parent step', () => {
    expect(sliceStepFor(10800)).toBe(540);
    expect(sliceStepFor(600, 540)).toBe(30);
    expect(sliceStepFor(3600, 540)).toBe(180);
  });
});
