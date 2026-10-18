import React from 'react';
import { Button, Stack, Text } from '@grafana/ui';
import { SceneTimeRange } from '@grafana/scenes';
import { QueryWindow, shouldOfferWiden } from './window';
import { WIDENED_WINDOW } from './presets';
import { testIds } from '../components/testIds';

interface WidenWindowPromptProps {
  window: QueryWindow;
  observedItems: number;
  timeRange: SceneTimeRange;
}

export function WidenWindowPrompt({ window, observedItems, timeRange }: WidenWindowPromptProps) {
  if (!shouldOfferWiden(window, observedItems)) {
    return null;
  }
  const widen = () => timeRange.setState({ from: WIDENED_WINDOW, to: 'now' });
  return (
    <Stack gap={1} alignItems="center" wrap="wrap" data-testid={testIds.window.widenPrompt}>
      <Text color="secondary">
        Little telemetry in this window, so services that emit less than daily may be missing.
      </Text>
      <Button size="sm" variant="secondary" onClick={widen} data-testid={testIds.window.widenButton}>
        Widen to 7 days
      </Button>
    </Stack>
  );
}
