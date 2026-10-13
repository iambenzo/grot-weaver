import {
  EmbeddedScene,
  SceneAppPage,
  SceneControlsSpacer,
  SceneFlexItem,
  SceneFlexLayout,
  SceneRefreshPicker,
} from '@grafana/scenes';
import { ROUTES } from '../../constants';
import { prefixRoute } from '../../utils/utils.routing';
import { PluginSettings } from '../../settings/settings';
import { createTimePicker, createTimeRange } from '../../window/window';
import { PlatformOverview } from './PlatformOverview';

export function overviewPage(settings: PluginSettings): SceneAppPage {
  return new SceneAppPage({
    title: 'Overview',
    subTitle: 'How well this stack conforms to OpenTelemetry semantic conventions, and which violations matter most.',
    url: prefixRoute(ROUTES.Overview),
    routePath: ROUTES.Overview,
    getScene: () =>
      new EmbeddedScene({
        $timeRange: createTimeRange(settings),
        controls: [
          new SceneControlsSpacer(),
          createTimePicker(),
          new SceneRefreshPicker({ isOnCanvas: true, withText: true }),
        ],
        body: new SceneFlexLayout({
          direction: 'column',
          children: [new SceneFlexItem({ body: new PlatformOverview({ settings }) })],
        }),
      }),
  });
}
