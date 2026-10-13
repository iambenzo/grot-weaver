import React from 'react';
import { Alert, Button } from '@grafana/ui';
import { SceneTimeRange } from '@grafana/scenes';
import { QueryWindow, shouldOfferWiden, WIDENED_WINDOW } from './window';
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
    <Alert severity="info" title="Little telemetry in this window" data-testid={testIds.window.widenPrompt}>
      Services that emit less than daily may be missing.{' '}
      <Button size="sm" variant="secondary" onClick={widen} data-testid={testIds.window.widenButton}>
        Widen to 7 days
      </Button>
    </Alert>
  );
}
