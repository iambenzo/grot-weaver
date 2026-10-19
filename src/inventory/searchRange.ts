import { ProxyGet } from '../datasources/proxy';
import { QueryWindow } from '../window/window';
import { durationMatching } from './traceqlMetrics';

export const DEFAULT_SEARCH_MAX_SECONDS = 7 * 24 * 3600;
const SEARCH_PATH = /^\/api\/(search$|v2\/search\/)/;
const SEARCH_RANGE_PATTERN = /exceeds ((?:\d+(?:\.\d+)?(?:h|ms|m|s))+)/;

export interface SearchRange {
  get: ProxyGet;
  searched: () => QueryWindow | undefined;
}

export function limitSearchRange(get: ProxyGet, maxSeconds = DEFAULT_SEARCH_MAX_SECONDS): SearchRange {
  let allowedSeconds = maxSeconds;
  let searched: QueryWindow | undefined;

  const clamp = (params: Record<string, string>): Record<string, string> => {
    const start = Number(params.start);
    const end = Number(params.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end - start <= allowedSeconds) {
      return params;
    }
    const clampedStart = end - allowedSeconds;
    searched = { startSeconds: Math.max(clampedStart, searched?.startSeconds ?? clampedStart), endSeconds: end };
    return { ...params, start: String(clampedStart) };
  };

  const limited = async <T>(
    uid: string,
    path: string,
    params: Record<string, string>,
    headers?: Record<string, string>
  ): Promise<T> => {
    if (!SEARCH_PATH.test(path)) {
      return get<T>(uid, path, params, headers);
    }
    const sent = clamp(params);
    try {
      return await get<T>(uid, path, sent, headers);
    } catch (error) {
      const reported = isBadRequest(error) ? durationMatching(error, SEARCH_RANGE_PATTERN) : undefined;
      const sentSeconds = Number(sent.end) - Number(sent.start);
      if (reported === undefined || !Number.isFinite(sentSeconds) || Math.floor(reported) >= sentSeconds) {
        throw error;
      }
      allowedSeconds = Math.min(allowedSeconds, Math.floor(reported));
      return get<T>(uid, path, clamp(params), headers);
    }
  };

  return { get: limited, searched: () => searched };
}

function isBadRequest(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 400;
}
