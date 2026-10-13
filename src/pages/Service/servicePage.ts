import { EmbeddedScene, SceneAppPage, SceneControlsSpacer, SceneFlexItem, SceneFlexLayout, SceneRefreshPicker } from '@grafana/scenes';
import { ROUTES } from '../../constants';
import { prefixRoute } from '../../utils/utils.routing';
import { PluginSettings } from '../../settings/settings';
import { createTimePicker, createTimeRange } from '../../window/window';
import { ServiceFindings } from './ServiceFindings';

export function servicePage(settings: PluginSettings): SceneAppPage {
  return new SceneAppPage({
    title: 'Service',
    subTitle: 'Semantic convention findings for one service, and where to fix them.',
    url: prefixRoute(ROUTES.Service),
    routePath: ROUTES.Service,
    getScene: () => serviceScene(settings),
  });
}

function serviceScene(settings: PluginSettings): EmbeddedScene {
  return new EmbeddedScene({
    $timeRange: createTimeRange(settings),
    controls: [new SceneControlsSpacer(), createTimePicker(), new SceneRefreshPicker({ isOnCanvas: true })],
    body: new SceneFlexLayout({
      direction: 'column',
      children: [new SceneFlexItem({ body: new ServiceFindings({ settings }) })],
    }),
  });
}
