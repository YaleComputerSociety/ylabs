import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import useLatestRequest from '../useLatestRequest';

describe('useLatestRequest', () => {
  it('aborts and demotes the previous ticket when a new request begins', () => {
    const { result } = renderHook(() => useLatestRequest());

    const first = result.current.begin();
    const second = result.current.begin();

    expect(first.signal.aborted).toBe(true);
    expect(first.isCurrent()).toBe(false);
    expect(second.signal.aborted).toBe(false);
    expect(second.isCurrent()).toBe(true);
  });

  it('aborts the in-flight ticket on cancel and on unmount', () => {
    const { result, unmount } = renderHook(() => useLatestRequest());

    const cancelled = result.current.begin();
    result.current.cancel();
    expect(cancelled.signal.aborted).toBe(true);
    expect(cancelled.isCurrent()).toBe(false);

    const inFlight = result.current.begin();
    unmount();
    expect(inFlight.signal.aborted).toBe(true);
  });
});
