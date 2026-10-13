import { DEFAULT_CONCURRENCY, concurrencyFrom, datasourceTypesFor, isVolumeWeighted, readSettings } from './settings';

describe('readSettings', () => {
  it.each([
    [undefined, {}],
    [null, {}],
    ['text', {}],
    [{ defaultWindow: 'now-7d' }, { defaultWindow: 'now-7d' }],
    [{ defaultWindow: 7 }, {}],
    [{ datasourceTypes: { traces: ['tempo', 'grafana-tempo-datasource'], metrics: 'prometheus' } }, { datasourceTypes: { traces: ['tempo', 'grafana-tempo-datasource'] } }],
    [{ concurrency: 8 }, { concurrency: 8 }],
    [{ volumeWeighted: true }, { volumeWeighted: true }],
    [{ volumeWeighted: 'yes' }, {}],
    [{ reclassification: [{ pattern: 'acme_*', action: 'exclude' }] }, { reclassification: [{ pattern: 'acme_*', action: 'exclude' }] }],
    [{ reclassification: [{ pattern: 'acme_*', action: 'drop' }] }, {}],
  ])('reads %p', (jsonData, expected) => {
    expect(readSettings(jsonData)).toEqual(expected);
  });
});

describe('datasourceTypesFor', () => {
  it('falls back to the built-in types', () => {
    expect(datasourceTypesFor({}, 'traces')).toEqual(['tempo']);
    expect(datasourceTypesFor({ datasourceTypes: { traces: [] } }, 'traces')).toEqual(['tempo']);
  });

  it('uses configured types', () => {
    expect(datasourceTypesFor({ datasourceTypes: { metrics: ['grafana-amazonprometheus-datasource'] } }, 'metrics')).toEqual([
      'grafana-amazonprometheus-datasource',
    ]);
  });
});

describe('isVolumeWeighted', () => {
  it('is off unless explicitly enabled', () => {
    expect(isVolumeWeighted({})).toBe(false);
    expect(isVolumeWeighted({ volumeWeighted: true })).toBe(true);
  });
});

describe('concurrencyFrom', () => {
  it.each([
    [undefined, DEFAULT_CONCURRENCY],
    [0, DEFAULT_CONCURRENCY],
    [2.5, DEFAULT_CONCURRENCY],
    [6, 6],
    [500, 32],
  ])('maps %p to %p', (configured, expected) => {
    expect(concurrencyFrom({ concurrency: configured })).toBe(expected);
  });
});
