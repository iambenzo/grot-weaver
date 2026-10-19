import React from 'react';
import { render, screen } from '@testing-library/react';
import { AppRootProps } from '@grafana/data';
import { PluginPropsContext } from '../utils/utils.plugin';
import { AskAssistant } from './AskAssistant';

const mockAvailability = { isAvailable: true, isLoading: false };

jest.mock('@grafana/assistant', () => ({
  useAssistant: () => mockAvailability,
  OpenAssistantButton: (props: { origin: string; prompt: string; autoSend: boolean; title: string }) => (
    <button data-origin={props.origin} data-prompt={props.prompt} data-autosend={String(props.autoSend)}>
      {props.title}
    </button>
  ),
}));

const withSettings = (jsonData: object) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <PluginPropsContext.Provider value={{ meta: { jsonData } } as unknown as AppRootProps}>
        {children}
      </PluginPropsContext.Provider>
    );
  };

describe('AskAssistant', () => {
  afterEach(() => Object.assign(mockAvailability, { isAvailable: true, isLoading: false }));

  it('renders nothing while the availability check runs', () => {
    Object.assign(mockAvailability, { isAvailable: false, isLoading: true });

    const { container } = render(<AskAssistant origin="finding" prompt="Explain this" />);

    expect(container).toBeEmptyDOMElement();
  });

  it('opens the Assistant with the prompt unsent, attributed to the plugin', () => {
    render(<AskAssistant origin="top-violation" prompt="Explain this" />);

    const button = screen.getByRole('button', { name: 'Ask Assistant' });
    expect(button).toHaveAttribute('data-origin', 'benburbage-semconvcompliance-app/top-violation');
    expect(button).toHaveAttribute('data-prompt', 'Explain this');
    expect(button).toHaveAttribute('data-autosend', 'false');
  });

  it('renders nothing when an admin has turned the buttons off', () => {
    const { container } = render(<AskAssistant origin="finding" prompt="Explain this" />, {
      wrapper: withSettings({ assistantButtons: false }),
    });

    expect(container).toBeEmptyDOMElement();
  });
});
