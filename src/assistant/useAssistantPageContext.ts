import { useEffect, useMemo } from 'react';
import { createAssistantContextItem, providePageContext } from '@grafana/assistant';
import { Load } from '../assessment/useStackAssessment';
import { PLUGIN_BASE_URL, ROUTES } from '../constants';
import { useAskAssistantShown } from './AskAssistant';
import { PageScan } from './pageContext';

export function useAssistantPageContext(route: ROUTES, title: string, data: Record<string, unknown> | undefined) {
  const shown = useAskAssistantShown();
  const serialized = shown && data ? JSON.stringify(data) : undefined;
  useEffect(() => {
    if (serialized === undefined) {
      return;
    }
    const registration = providePageContext(`${PLUGIN_BASE_URL}/${route}**`, [
      createAssistantContextItem('structured', { title, data: JSON.parse(serialized) }),
    ]);
    return () => registration.unregister();
  }, [route, title, serialized]);
}

export function usePageScan(load: Load): PageScan | undefined {
  const ready = load.status === 'ready' ? load : undefined;
  const assessment = ready?.assessment;
  const progress = ready?.progress;
  const savedAtMs = ready?.savedAtMs;
  const scanning = ready?.scanning === true;
  return useMemo(
    () => (assessment && progress ? { assessment, progress, savedAtMs, scanning } : undefined),
    [assessment, progress, savedAtMs, scanning]
  );
}
