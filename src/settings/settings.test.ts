import {
  DEFAULT_CONCURRENCY,
  concurrencyFrom,
  datasourceTypesFor,
  isExcluded,
  isUpstreamCheckEnabled,
  isVolumeWeighted,
  readSettings,
  requiredResourceAttributes,
  sampleLimit,
  withStrategyOverride,
} from './settings';

describe('readSettings', () => {
  it.each([
    [undefined, {}],
    [null, {}],
    ['text', {}],
    [{ defaultWindow: 'now-7d' }, { defaultWindow: 'now-7d' }],
    [{ defaultWindow: 7 }, {}],
    [
      { datasourceTypes: { traces: ['tempo', 'grafana-tempo-datasource'], metrics: 'prometheus' } },
      { datasourceTypes: { traces: ['tempo', 'grafana-tempo-datasource'] } },
    ],
    [{ concurrency: 8 }, { concurrency: 8 }],
    [{ volumeWeighted: true }, { volumeWeighted: true }],
    [{ volumeWeighted: 'yes' }, {}],
    [
      { reclassification: [{ pattern: 'acme_*', action: 'exclude' }] },
      { reclassification: [{ pattern: 'acme_*', action: 'exclude' }] },
    ],
    [{ reclassification: [{ pattern: 'acme_*', action: 'drop' }] }, {}],
    [
      { strategyOverrides: { prom: 'NoTranslation', other: 'Sideways' } },
      { strategyOverrides: { prom: 'NoTranslation' } },
    ],
    [
      { excludedDatasources: ['grafanacloud-usage'], customNamespaces: ['acme'] },
      { excludedDatasources: ['grafanacloud-usage'], customNamespaces: ['acme'] },
    ],
    [{ excludedDatasources: [1] }, {}],
    [{ requiredResourceAttributes: ['service.name'] }, { requiredResourceAttributes: ['service.name'] }],
    [{ requiredResourceAttributes: [] }, { requiredResourceAttributes: [] }],
    [{ requiredResourceAttributes: 'service.name' }, {}],
    [
      { traceSampleLimit: 50, logSampleLimit: 10, upstreamCheck: false },
      { traceSampleLimit: 50, logSampleLimit: 10, upstreamCheck: false },
    ],
    [
      { pipelineMappings: [{ match: 'shop/*', pipeline: 'alloy-receiver' }] },
      { pipelineMappings: [{ match: 'shop/*', pipeline: 'alloy-receiver' }] },
    ],
    [{ pipelineMappings: [{ match: 'shop/*' }] }, {}],
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
    expect(
      datasourceTypesFor({ datasourceTypes: { metrics: ['grafana-amazonprometheus-datasource'] } }, 'metrics')
    ).toEqual(['grafana-amazonprometheus-datasource']);
  });
});

describe('withStrategyOverride', () => {
  const datasource = { uid: 'prom', names: [], target_info: [], owners: [], label_keys: [], collectors: [] };

  it('applies the admin override for that datasource only', () => {
    const settings = { strategyOverrides: { prom: 'UnderscoreEscapingWithoutSuffixes' as const } };
    expect(withStrategyOverride(datasource, settings).strategy_override).toBe('UnderscoreEscapingWithoutSuffixes');
    expect(withStrategyOverride({ ...datasource, uid: 'other' }, settings).strategy_override).toBeUndefined();
  });
});

describe('sampleLimit, upstream check and exclusions', () => {
  it.each([
    [undefined, 20],
    [0, 20],
    [50, 50],
    [10000, 500],
  ])('limit %p becomes %p', (configured, expected) => {
    expect(sampleLimit(configured, 20)).toBe(expected);
  });

  it('checks upstream releases unless turned off', () => {
    expect(isUpstreamCheckEnabled({})).toBe(true);
    expect(isUpstreamCheckEnabled({ upstreamCheck: false })).toBe(false);
  });

  it('excludes listed datasources only', () => {
    expect(isExcluded({ excludedDatasources: ['a'] }, 'a')).toBe(true);
    expect(isExcluded({}, 'a')).toBe(false);
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

describe('requiredResourceAttributes', () => {
  it('defaults to the four identity attributes and keeps an emptied list', () => {
    expect(requiredResourceAttributes({})).toEqual([
      'service.name',
      'service.namespace',
      'service.instance.id',
      'deployment.environment.name',
    ]);
    expect(requiredResourceAttributes({ requiredResourceAttributes: [] })).toEqual([]);
  });
});
