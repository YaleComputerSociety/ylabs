import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import usePlanNoteAutosave from '../usePlanNoteAutosave';

const setVisibility = (state: DocumentVisibilityState) =>
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });

afterEach(() => {
  vi.useRealTimers();
  setVisibility('visible');
});

describe('usePlanNoteAutosave', () => {
  it('reports a pending save from the first keystroke', () => {
    vi.useFakeTimers();
    const persist = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => usePlanNoteAutosave(persist));

    act(() => result.current.scheduleNoteSave('plan-1', 'draft'));

    expect(result.current.noteSaveStatuses['plan-1']).toBe('pending');
    expect(persist).not.toHaveBeenCalled();
  });

  it.each([
    ['pagehide', () => window.dispatchEvent(new Event('pagehide'))],
    [
      'a hidden document',
      () => {
        setVisibility('hidden');
        document.dispatchEvent(new Event('visibilitychange'));
      },
    ],
  ])('flushes a pending note with keepalive on %s', async (_label, hide) => {
    vi.useFakeTimers();
    const persist = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => usePlanNoteAutosave(persist));

    act(() => result.current.scheduleNoteSave('plan-1', 'draft'));
    await act(async () => hide());

    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith('plan-1', 'draft', { keepalive: true });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('sends nothing on hide when no save is pending', async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    renderHook(() => usePlanNoteAutosave(persist));

    await act(async () => window.dispatchEvent(new Event('pagehide')));

    expect(persist).not.toHaveBeenCalled();
  });

  it('flushes a pending note when the surface unmounts', async () => {
    vi.useFakeTimers();
    const persist = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() => usePlanNoteAutosave(persist));

    act(() => result.current.scheduleNoteSave('plan-1', 'draft'));
    unmount();

    expect(persist).toHaveBeenCalledWith('plan-1', 'draft', { keepalive: true });
  });

  it('asks the browser to hold an unload only while a note is unsaved', () => {
    vi.useFakeTimers();
    const persist = vi.fn(() => new Promise<void>(() => {}));
    const { result } = renderHook(() => usePlanNoteAutosave(persist));

    const idle = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(idle);
    expect(idle.defaultPrevented).toBe(false);

    act(() => result.current.scheduleNoteSave('plan-1', 'draft'));
    const unsaved = new Event('beforeunload', { cancelable: true });
    act(() => {
      window.dispatchEvent(unsaved);
    });
    expect(unsaved.defaultPrevented).toBe(true);
    expect(persist).toHaveBeenCalledWith('plan-1', 'draft', { keepalive: true });
  });

  it('keeps a note whose save failed unsaved so an unload holds and retries it', async () => {
    vi.useFakeTimers();
    const persist = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);
    const { result } = renderHook(() => usePlanNoteAutosave(persist));

    act(() => result.current.scheduleNoteSave('plan-1', 'draft'));
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(result.current.noteSaveStatuses['plan-1']).toBe('error');

    const unload = new Event('beforeunload', { cancelable: true });
    await act(async () => {
      window.dispatchEvent(unload);
    });

    expect(unload.defaultPrevented).toBe(true);
    expect(persist).toHaveBeenLastCalledWith('plan-1', 'draft', { keepalive: true });
    expect(result.current.noteSaveStatuses['plan-1']).toBe('saved');
  });

  it('retries a note whose save failed when the document is hidden', async () => {
    vi.useFakeTimers();
    const persist = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);
    const { result } = renderHook(() => usePlanNoteAutosave(persist));

    act(() => result.current.scheduleNoteSave('plan-1', 'draft'));
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    await act(async () => {
      setVisibility('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenLastCalledWith('plan-1', 'draft', { keepalive: true });
    expect(result.current.noteSaveStatuses['plan-1']).toBe('saved');
  });

  it('stops holding a failed note once its save is cancelled', async () => {
    vi.useFakeTimers();
    const persist = vi.fn().mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => usePlanNoteAutosave(persist));

    act(() => result.current.scheduleNoteSave('plan-1', 'draft'));
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    act(() => result.current.cancelNoteSave('plan-1'));

    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });

  it('reports saving rather than saved when an edit reverts to text still being saved', async () => {
    vi.useFakeTimers();
    let settle: () => void = () => {};
    const persist = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    const { result } = renderHook(() => usePlanNoteAutosave(persist));

    act(() => result.current.scheduleNoteSave('plan-1', 'draft'));
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    act(() => result.current.scheduleNoteSave('plan-1', 'draft!'));
    act(() => result.current.scheduleNoteSave('plan-1', 'draft'));
    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    expect(persist).toHaveBeenCalledTimes(1);
    expect(result.current.noteSaveStatuses['plan-1']).toBe('saving');

    await act(async () => settle());
    expect(result.current.noteSaveStatuses['plan-1']).toBe('saved');
  });
});
