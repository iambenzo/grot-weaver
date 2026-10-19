import { GrafanaConfig, locationUtil } from '@grafana/data';
import { exploreUrl } from '../assessment/explore';
import { appHref } from './utils.routing';
import { serviceLink } from './serviceLink';

function serveFrom(appSubUrl: string) {
  locationUtil.initialize({
    config: { appSubUrl } as GrafanaConfig,
    getTimeRangeForUrl: () => ({ from: 'now-1h', to: 'now' }),
    getVariablesUrlParams: () => ({}),
  });
}

describe('internal links', () => {
  afterEach(() => serveFrom(''));

  it.each([
    ['', '/connections/datasources/new'],
    ['/grafana', '/grafana/connections/datasources/new'],
  ])('builds hrefs for a Grafana served from %p', (subUrl, expected) => {
    serveFrom(subUrl);

    expect(appHref('/connections/datasources/new')).toBe(expected);
  });

  it('adds the sub-URL once, even to an href that already has it', () => {
    serveFrom('/grafana');

    expect(appHref(appHref('/explore'))).toBe('/grafana/explore');
  });

  it('leaves external links alone', () => {
    serveFrom('/grafana');

    expect(appHref('https://opentelemetry.io/docs/')).toBe('https://opentelemetry.io/docs/');
  });

  it('puts the sub-URL on service and Explore links', () => {
    serveFrom('/grafana');

    expect(serviceLink({ kind: 'service', name: 'checkout' }, { from: 'now-1h', to: 'now' })).toMatch(
      /^\/grafana\/a\/benburbage-semconvcompliance-app\/service\?/
    );
    expect(exploreUrl({ uid: 'tempo', type: 'tempo', query: '{ }' }, 'now-1h', 'now')).toMatch(/^\/grafana\/explore\?/);
  });
});
