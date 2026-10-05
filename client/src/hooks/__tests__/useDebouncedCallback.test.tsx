import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import useDebouncedCallback from '../useDebouncedCallback';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useDebouncedCallback', () => {
  it('calls the latest callback once with the last arguments after the delay', () => {
    const first = vi.fn();
    const latest = vi.fn();
    const { result, rerender } = renderHook(({ callback }) => useDebouncedCallback(callback, 300), {
      initialProps: { callback: first },
    });

    result.current('a');
    result.current('ab');
    rerender({ callback: latest });
    result.current('abc');
    vi.advanceTimersByTime(299);
    expect(latest).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
    expect(latest).toHaveBeenCalledWith('abc');
  });

  it('drops a pending call when the component unmounts', () => {
    const callback = vi.fn();
    const { result, unmount } = renderHook(() => useDebouncedCallback(callback, 300));

    result.current('pending');
    unmount();
    vi.advanceTimersByTime(300);

    expect(callback).not.toHaveBeenCalled();
  });
});
