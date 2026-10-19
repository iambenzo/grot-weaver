import React from 'react';
import { renderHook } from '@testing-library/react';
import { AppRootProps } from '@grafana/data';
import { PluginPropsContext } from '../utils/utils.plugin';
import { ROUTES } from '../constants';
import { useAssistantPageContext } from './useAssistantPageContext';

const mockAvailability = { isAvailable: true, isLoading: false };
const mockUnregister = jest.fn();
const mockProvide = jest.fn((_pattern: string, _context: unknown[]) => ({ unregister: mockUnregister }));

jest.mock('@grafana/assistant', () => ({
  useAssistant: () => mockAvailability,
  providePageContext: (pattern: string, context: unknown[]) => mockProvide(pattern, context),
  createAssistantContextItem: (type: string, params: object) => ({ type, ...params }),
}));

const withSettings = (jsonData: object) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <PluginPropsContext.Provider value={{ meta: { jsonData } } as unknown as AppRootProps}>
        {children}
      </PluginPropsContext.Provider>
    );
  };

describe('useAssistantPageContext', () => {
  beforeEach(() => {
    mockProvide.mockClear();
    mockUnregister.mockClear();
    Object.assign(mockAvailability, { isAvailable: true });
  });

  it('registers the page data as one structured item for this page only, and unregisters on leaving', () => {
    const { unmount } = renderHook(() => useAssistantPageContext(ROUTES.Overview, 'Overview', { scores: 1 }));

    expect(mockProvide).toHaveBeenCalledTimes(1);
    expect(mockProvide).toHaveBeenCalledWith('/a/benburbage-semconvcompliance-app/overview**', [
      { type: 'structured', title: 'Overview', data: { scores: 1 } },
    ]);

    unmount();
    expect(mockUnregister).toHaveBeenCalledTimes(1);
  });

  it('replaces the context when the scan completes, and not when an equal object is rebuilt', () => {
    const { rerender } = renderHook(({ data }) => useAssistantPageContext(ROUTES.Service, 'Service', data), {
      initialProps: { data: { scan: { scoresFinal: false } } as Record<string, unknown> },
    });

    rerender({ data: { scan: { scoresFinal: false } } });
    expect(mockProvide).toHaveBeenCalledTimes(1);

    rerender({ data: { scan: { scoresFinal: true } } });
    expect(mockUnregister).toHaveBeenCalledTimes(1);
    expect(mockProvide).toHaveBeenCalledTimes(2);
    expect(mockProvide).toHaveBeenLastCalledWith('/a/benburbage-semconvcompliance-app/service**', [
      { type: 'structured', title: 'Service', data: { scan: { scoresFinal: true } } },
    ]);
  });

  it.each([
    ['the Assistant is unavailable', {}, false],
    ['an admin has turned it off', { assistantButtons: false }, true],
  ])('registers nothing when %s', (_, jsonData, available) => {
    mockAvailability.isAvailable = available;

    renderHook(() => useAssistantPageContext(ROUTES.Overview, 'Overview', { scores: 1 }), {
      wrapper: withSettings(jsonData),
    });

    expect(mockProvide).not.toHaveBeenCalled();
  });

  it('registers nothing until the scan has data', () => {
    renderHook(() => useAssistantPageContext(ROUTES.Overview, 'Overview', undefined));

    expect(mockProvide).not.toHaveBeenCalled();
  });
});
