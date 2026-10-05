import { act, renderHook } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import useLoadEffect from '../useLoadEffect';

const flushMicrotasks = () => act(async () => {});

describe('useLoadEffect', () => {
  it('starts the load after the effect body returns rather than inside it', async () => {
    const load = vi.fn();
    renderHook(() => useLoadEffect(load));

    expect(load).not.toHaveBeenCalled();
    await flushMicrotasks();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('loads once under StrictMode effect replay', async () => {
    const load = vi.fn();
    renderHook(() => useLoadEffect(load), {
      wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>,
    });

    await flushMicrotasks();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('waits for the trigger and reloads when the trigger or the loader changes', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ load, when }: { load: () => void; when: unknown }) => useLoadEffect(load, when),
      { initialProps: { load: first, when: null as unknown } },
    );

    await flushMicrotasks();
    expect(first).not.toHaveBeenCalled();

    rerender({ load: first, when: { page: 1 } });
    await flushMicrotasks();
    expect(first).toHaveBeenCalledTimes(1);

    rerender({ load: first, when: { page: 2 } });
    await flushMicrotasks();
    expect(first).toHaveBeenCalledTimes(2);

    rerender({ load: second, when: { page: 2 } });
    await flushMicrotasks();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('drops a pending load when the component unmounts first', async () => {
    const load = vi.fn();
    const { unmount } = renderHook(() => useLoadEffect(load));

    unmount();
    await flushMicrotasks();
    expect(load).not.toHaveBeenCalled();
  });
});
