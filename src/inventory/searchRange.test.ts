import { ProxyGet } from '../datasources/proxy';
import { DEFAULT_SEARCH_MAX_SECONDS, limitSearchRange } from './searchRange';

const DAY = 24 * 3600;
const end = 2_000_000;

function fakeTempo(maxSeconds: number) {
  const calls: Array<{ path: string; params: Record<string, string> }> = [];
  const get = (async (_uid: string, path: string, params: Record<string, string>) => {
    calls.push({ path, params });
    const length = Number(params.end) - Number(params.start);
    if (path !== '/api/metrics/query_range' && length > maxSeconds) {
      throw {
        status: 400,
        data: `range specified by start and end exceeds ${maxSeconds / 3600}h0m0s. received start=${params.start} end=${params.end}`,
      };
    }
    return { ok: true };
  }) as ProxyGet;
  return { get, calls };
}

describe('limitSearchRange', () => {
  it('keeps the latest seven days of a longer search and reports the window searched', async () => {
    const tempo = fakeTempo(DEFAULT_SEARCH_MAX_SECONDS);
    const range = limitSearchRange(tempo.get);

    await range.get('tempo', '/api/v2/search/tags', { start: String(end - 30 * DAY), end: String(end), scope: 'span' });
    await range.get('tempo', '/api/search', { start: String(end - 30 * DAY), end: String(end), q: '{ }' });

    expect(tempo.calls.map((call) => call.params.start)).toEqual([String(end - 7 * DAY), String(end - 7 * DAY)]);
    expect(tempo.calls[0].params.scope).toBe('span');
    expect(range.searched()).toEqual({ startSeconds: end - 7 * DAY, endSeconds: end });
  });

  it('leaves a search within the limit, and other requests, untouched', async () => {
    const tempo = fakeTempo(DEFAULT_SEARCH_MAX_SECONDS);
    const range = limitSearchRange(tempo.get);

    await range.get('tempo', '/api/search', { start: String(end - 7 * DAY), end: String(end) });
    await range.get('tempo', '/api/metrics/query_range', { start: String(end - 30 * DAY), end: String(end) });

    expect(tempo.calls.map((call) => call.params.start)).toEqual([String(end - 7 * DAY), String(end - 30 * DAY)]);
    expect(range.searched()).toBeUndefined();
  });

  it('learns a smaller limit from Tempo, retries once and keeps using it', async () => {
    const tempo = fakeTempo(DAY);
    const range = limitSearchRange(tempo.get);

    await range.get('tempo', '/api/v2/search/tag/resource.service.name/values', {
      start: String(end - 7 * DAY),
      end: String(end),
    });
    await range.get('tempo', '/api/search', { start: String(end - 7 * DAY), end: String(end) });

    expect(tempo.calls.map((call) => Number(call.params.end) - Number(call.params.start))).toEqual([7 * DAY, DAY, DAY]);
    expect(range.searched()).toEqual({ startSeconds: end - DAY, endSeconds: end });
  });

  it('does not retry a failure that is not a 400, even when it mentions a limit', async () => {
    const failure = { status: 500, data: 'upstream exceeds 1h0m0s budget' };
    const calls: string[] = [];
    const get = (async (_uid: string, path: string) => {
      calls.push(path);
      throw failure;
    }) as ProxyGet;
    const range = limitSearchRange(get);

    await expect(range.get('tempo', '/api/search', { start: String(end - DAY), end: String(end) })).rejects.toBe(
      failure
    );
    expect(calls).toHaveLength(1);
    expect(range.searched()).toBeUndefined();
  });

  it('does not retry a search without a time range', async () => {
    const failure = { status: 400, data: 'range exceeds 1h0m0s' };
    const calls: string[] = [];
    const get = (async (_uid: string, path: string) => {
      calls.push(path);
      throw failure;
    }) as ProxyGet;

    await expect(limitSearchRange(get).get('tempo', '/api/search', { q: '{ }' })).rejects.toBe(failure);
    expect(calls).toHaveLength(1);
  });

  it('passes on other failures without retrying', async () => {
    const failure = { status: 500, data: 'tempo exploded' };
    const calls: string[] = [];
    const get = (async (_uid: string, path: string) => {
      calls.push(path);
      throw failure;
    }) as ProxyGet;

    await expect(
      limitSearchRange(get).get('tempo', '/api/search', { start: String(end - DAY), end: String(end) })
    ).rejects.toBe(failure);
    expect(calls).toHaveLength(1);
  });
});
