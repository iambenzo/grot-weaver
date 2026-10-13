import { LATEST_RELEASE_URL, UpstreamCheckDependencies, isNewerRelease, latestRelease } from './upstream';

const release = {
  tag_name: 'v1.45.0',
  html_url: 'https://github.com/open-telemetry/semantic-conventions/releases/tag/v1.45.0',
};
const DAY_MS = 24 * 60 * 60 * 1000;

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value),
  };
}

function dependencies(fetchJson: UpstreamCheckDependencies['fetchJson'], startMs = 0) {
  let nowMs = startMs;
  const deps: UpstreamCheckDependencies = { fetchJson, storage: memoryStorage(), nowMs: () => nowMs };
  return { deps, advance: (ms: number) => (nowMs += ms) };
}

describe('latestRelease', () => {
  it('asks GitHub for the latest release and caches it for 24 hours', async () => {
    const fetchJson = jest.fn(async () => release);
    const { deps, advance } = dependencies(fetchJson);

    expect(await latestRelease(deps)).toEqual({ tag: 'v1.45.0', url: release.html_url });
    advance(DAY_MS - 1);
    await latestRelease(deps);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(fetchJson).toHaveBeenCalledWith(LATEST_RELEASE_URL);

    advance(1);
    await latestRelease(deps);
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it('fails silently and does not retry within the day', async () => {
    const fetchJson = jest.fn(async () => {
      throw new Error('rate limited');
    });
    const { deps } = dependencies(fetchJson);

    expect(await latestRelease(deps)).toBeUndefined();
    expect(await latestRelease(deps)).toBeUndefined();
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it('ignores drafts, prereleases and malformed bodies', async () => {
    for (const body of [{ ...release, draft: true }, { ...release, prerelease: true }, { message: 'Not Found' }]) {
      const { deps } = dependencies(async () => body);
      expect(await latestRelease(deps)).toBeUndefined();
    }
  });

  it('still answers when storage throws', async () => {
    const deps: UpstreamCheckDependencies = {
      fetchJson: async () => release,
      storage: {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
      },
      nowMs: () => 0,
    };

    expect((await latestRelease(deps))?.tag).toBe('v1.45.0');
  });
});

describe('isNewerRelease', () => {
  it.each([
    ['v1.45.0', 'v1.44.0', true],
    ['v1.44.1', '1.44.0', true],
    ['v2.0.0', 'v1.44.0', true],
    ['v1.44.0', 'v1.44.0', false],
    ['v1.43.0', 'v1.44.0', false],
    ['v1.45.0-rc.1', 'v1.44.0', false],
    ['v1.45.0', 'unknown', false],
  ])('%s against %s is %p', (latest, current, expected) => {
    expect(isNewerRelease(latest, current)).toBe(expected);
  });
});
