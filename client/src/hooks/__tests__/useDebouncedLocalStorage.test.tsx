import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_DEBOUNCED_STORAGE_KEY_LENGTH,
  MAX_DEBOUNCED_STORAGE_VALUE_LENGTH,
  useDebouncedLocalStorage,
} from '../useDebouncedLocalStorage';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('useDebouncedLocalStorage', () => {
  it('writes bounded serialized values after the debounce delay', () => {
    vi.useFakeTimers();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    renderHook(() => useDebouncedLocalStorage('safe-key', { ok: true }, 50));

    expect(setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(setItem).toHaveBeenCalledWith('safe-key', JSON.stringify({ ok: true }));
  });

  it('rejects oversized keys before scheduling storage work', () => {
    vi.useFakeTimers();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    renderHook(() =>
      useDebouncedLocalStorage('k'.repeat(MAX_DEBOUNCED_STORAGE_KEY_LENGTH + 1), { ok: true }, 50),
    );

    vi.advanceTimersByTime(50);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('removes oversized serialized values instead of writing them', () => {
    vi.useFakeTimers();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');

    renderHook(() =>
      useDebouncedLocalStorage('safe-key', 'x'.repeat(MAX_DEBOUNCED_STORAGE_VALUE_LENGTH + 1), 50),
    );

    vi.advanceTimersByTime(50);
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).toHaveBeenCalledWith('safe-key');
  });
});
