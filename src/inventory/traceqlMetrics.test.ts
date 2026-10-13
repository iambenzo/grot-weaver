import { ProxyGet } from '../datasources/proxy';
import { createLimiter } from '../datasources/limiter';
import { maxDurationOf, queryMetricsRange, sliceWindow } from './traceqlMetrics';

const capped = { status: 400, data: 'metrics query time range exceeds the maximum allowed duration of 3h0m0s' };
const label = (service: string) => [{ key: 'resource.service.name', value: { stringValue: service } }];

function cappedTempo(maxSeconds: number) {
  const calls: Array<Record<string, string>> = [];
  const get = (async (_uid: string, _path: string, params: Record<string, string>) => {
    calls.push(params);
    const start = Number(params.start);
    if (Number(params.end) - start > maxSeconds) {
      throw capped;
    }
    return { series: [{ labels: label('checkout'), samples: [{ timestampMs: String(start * 1000), value: 2 }] }] };
  }) as ProxyGet;
  return { get, calls };
}

describe('queryMetricsRange', () => {
  it('uses one query when the window fits', async () => {
    const { get, calls } = cappedTempo(3 * 3600);
    const window = { startSeconds: 0, endSeconds: 3600 };

    const series = await queryMetricsRange({ uid: 'tempo', get, limit: createLimiter(2), window }, '{ }');

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ q: '{ }', step: '180s', start: '0', end: '3600' });
    expect(series[0].samples).toHaveLength(1);
  });

  it('splits the window at the advertised maximum and merges series by labels', async () => {
    const { get, calls } = cappedTempo(3 * 3600);
    const window = { startSeconds: 0, endSeconds: 24 * 3600 };

    const series = await queryMetricsRange({ uid: 'tempo', get, limit: createLimiter(2), window }, '{ }');

    expect(calls).toHaveLength(11);
    expect(calls[1]).toMatchObject({ start: '0', end: '8640', step: '432s' });
    expect(series).toHaveLength(1);
    expect(series[0].samples).toHaveLength(10);
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

describe('maxDurationOf', () => {
  it.each([
    [capped, 10800],
    [{ data: { message: 'exceeds the maximum allowed duration of 1h30m0s' } }, 5400],
    [{ message: 'exceeds the maximum allowed duration of 168h0m0s' }, 604800],
    [{ data: { message: 'empty ring' } }, undefined],
    ['boom', undefined],
  ])('reads %p as %p seconds', (error, expected) => {
    expect(maxDurationOf(error)).toBe(expected);
  });
});

describe('sliceWindow', () => {
  it('leaves headroom below the maximum, covers the window and trims the last slice', () => {
    expect(sliceWindow({ startSeconds: 0, endSeconds: 6000 }, 3000)).toEqual([
      { startSeconds: 0, endSeconds: 2400 },
      { startSeconds: 2400, endSeconds: 4800 },
      { startSeconds: 4800, endSeconds: 6000 },
    ]);
  });
});
