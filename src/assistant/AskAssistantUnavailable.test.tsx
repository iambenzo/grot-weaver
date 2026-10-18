import React from 'react';
import { act, render } from '@testing-library/react';
import { AskAssistant } from './AskAssistant';

describe('AskAssistant without Grafana Assistant', () => {
  it('renders nothing once the availability check has finished', async () => {
    jest.useFakeTimers();
    const { container } = render(<AskAssistant origin="finding" prompt="Explain this" />);

    await act(async () => {
      await jest.runAllTimersAsync();
    });

    expect(container).toBeEmptyDOMElement();
    jest.useRealTimers();
  });
});
