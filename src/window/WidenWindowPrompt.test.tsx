import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { SceneTimeRange } from '@grafana/scenes';
import { WidenWindowPrompt } from './WidenWindowPrompt';
import { testIds } from '../components/testIds';

const day = 24 * 3600;

describe('WidenWindowPrompt', () => {
  it('widens the shared time range to 7 days', () => {
    const timeRange = new SceneTimeRange({ from: 'now-24h', to: 'now' });
    render(<WidenWindowPrompt window={{ startSeconds: 0, endSeconds: day }} observedItems={0} timeRange={timeRange} />);

    fireEvent.click(screen.getByTestId(testIds.window.widenButton));

    expect(timeRange.state.from).toBe('now-7d');
  });

  it('stays hidden when the window has enough telemetry', () => {
    const timeRange = new SceneTimeRange({ from: 'now-24h', to: 'now' });
    render(<WidenWindowPrompt window={{ startSeconds: 0, endSeconds: day }} observedItems={10} timeRange={timeRange} />);

    expect(screen.queryByTestId(testIds.window.widenPrompt)).toBeNull();
  });
});
