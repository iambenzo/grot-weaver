import React, { useCallback } from 'react';
import { SceneApp, useSceneApp } from '@grafana/scenes';
import { AppRootProps } from '@grafana/data';
import { PluginPropsContext } from '../../utils/utils.plugin';
import { readSettings } from '../../settings/settings';
import { servicePage } from '../../pages/Service/servicePage';

function AppWithScenes({ jsonData }: { jsonData: unknown }) {
  const createApp = useCallback(() => {
    const settings = readSettings(jsonData);
    return new SceneApp({
      pages: [servicePage(settings)],
      urlSyncOptions: {
        updateUrlOnInit: true,
        createBrowserHistorySteps: true,
      },
    });
  }, [jsonData]);
  const scene = useSceneApp(createApp);
  return <scene.Component model={scene} />;
}

function App(props: AppRootProps) {
  return (
    <PluginPropsContext.Provider value={props}>
      <AppWithScenes jsonData={props.meta.jsonData} />
    </PluginPropsContext.Provider>
  );
}

export default App;
