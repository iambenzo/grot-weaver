import { useEffect, useState } from 'react';
import { browserStorage, useStoredValue } from '../storage/useStoredValue';

export const LATEST_RELEASE_URL = 'https://api.github.com/repos/open-telemetry/semantic-conventions/releases/latest';
const CACHE_KEY = 'benburbage-semconvcompliance-app.upstream-release';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DISMISSED_KEY = 'benburbage-semconvcompliance-app.upstream-dismissed';

export interface UpstreamRelease {
  tag: string;
  url: string;
}

interface CachedCheck {
  checkedAtMs: number;
  release?: UpstreamRelease;
}

export interface UpstreamCheckDependencies {
  fetchJson: (url: string) => Promise<unknown>;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  nowMs: () => number;
}

export async function latestRelease(deps: UpstreamCheckDependencies): Promise<UpstreamRelease | undefined> {
  const cached = readCache(deps);
  if (cached && deps.nowMs() - cached.checkedAtMs < CACHE_TTL_MS) {
    return cached.release;
  }
  const release = await deps
    .fetchJson(LATEST_RELEASE_URL)
    .then(releaseFrom)
    .catch(() => undefined);
  writeCache(deps, { checkedAtMs: deps.nowMs(), release });
  return release;
}

export function isNewerRelease(latestTag: string, currentVersion: string): boolean {
  const latest = versionParts(latestTag);
  const current = versionParts(currentVersion);
  if (!latest || !current) {
    return false;
  }
  for (let index = 0; index < latest.length; index++) {
    if (latest[index] !== current[index]) {
      return latest[index] > current[index];
    }
  }
  return false;
}

export function useUpstreamRelease(enabled: boolean): UpstreamRelease | undefined {
  const [release, setRelease] = useState<UpstreamRelease>();
  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    latestRelease(browserDependencies()).then((latest) => !cancelled && setRelease(latest));
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return enabled ? release : undefined;
}

export function useDismissedRelease(): [string | undefined, (tag: string) => void] {
  return useStoredValue(DISMISSED_KEY);
}

function browserDependencies(): UpstreamCheckDependencies {
  return {
    fetchJson: async (url) => {
      const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
      if (!response.ok) {
        throw new Error(`status ${response.status}`);
      }
      return response.json();
    },
    storage: browserStorage(),
    nowMs: () => Date.now(),
  };
}

function releaseFrom(body: unknown): UpstreamRelease | undefined {
  const candidate = (body ?? {}) as { tag_name?: unknown; html_url?: unknown; draft?: unknown; prerelease?: unknown };
  if (typeof candidate.tag_name !== 'string' || typeof candidate.html_url !== 'string') {
    return undefined;
  }
  if (candidate.draft === true || candidate.prerelease === true) {
    return undefined;
  }
  return { tag: candidate.tag_name, url: candidate.html_url };
}

function versionParts(version: string): number[] | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  return match ? match.slice(1).map(Number) : undefined;
}

function readCache(deps: UpstreamCheckDependencies): CachedCheck | undefined {
  try {
    const raw = deps.storage?.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as CachedCheck) : undefined;
  } catch {
    return undefined;
  }
}

function writeCache(deps: UpstreamCheckDependencies, check: CachedCheck) {
  try {
    deps.storage?.setItem(CACHE_KEY, JSON.stringify(check));
  } catch {
    return;
  }
}
