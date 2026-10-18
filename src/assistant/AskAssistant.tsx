import React from 'react';
import { OpenAssistantButton, useAssistant } from '@grafana/assistant';
import pluginJson from '../plugin.json';
import { isAssistantButtonsEnabled, readSettings } from '../settings/settings';
import { usePluginMeta } from '../utils/utils.plugin';

export type AssistantOrigin = 'finding' | 'top-violation';

interface AskAssistantProps {
  origin: AssistantOrigin;
  prompt: string;
}

export function useAskAssistantShown(): boolean {
  const settings = readSettings(usePluginMeta()?.jsonData);
  const { isAvailable } = useAssistant();
  return isAssistantButtonsEnabled(settings) && isAvailable;
}

export function AskAssistant({ origin, prompt }: AskAssistantProps) {
  if (!useAskAssistantShown()) {
    return null;
  }
  return (
    <OpenAssistantButton
      origin={`${pluginJson.id}/${origin}`}
      prompt={prompt}
      autoSend={false}
      title="Ask Assistant"
      size="sm"
    />
  );
}
