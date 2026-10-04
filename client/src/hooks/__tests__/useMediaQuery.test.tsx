import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import useMediaQuery from '../useMediaQuery';

type Listener = () => void;

const stubMatchMedia = (initial: boolean) => {
  const listeners = new Set<Listener>();
  const state = { matches: initial };
  const matchMedia = vi.fn((query: string) => ({
    media: query,
    get matches() {
      return state.matches;
    },
    addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
  }));
  vi.stubGlobal('matchMedia', matchMedia);
  return {
    listeners,
    change(next: boolean) {
      state.matches = next;
      listeners.forEach((listener) => listener());
    },
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useMediaQuery', () => {
  it('reads the current match on the first render', () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useMediaQuery('(min-width: 640px)'));
    expect(result.current).toBe(true);
  });

  it('follows media query changes and unsubscribes on unmount', () => {
    const media = stubMatchMedia(false);
    const { result, unmount } = renderHook(() => useMediaQuery('(min-width: 640px)'));
    expect(result.current).toBe(false);

    act(() => media.change(true));
    expect(result.current).toBe(true);

    unmount();
    expect(media.listeners.size).toBe(0);
  });

  it('reads false when the browser has no matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { result } = renderHook(() => useMediaQuery('(min-width: 640px)'));
    expect(result.current).toBe(false);
  });
});
