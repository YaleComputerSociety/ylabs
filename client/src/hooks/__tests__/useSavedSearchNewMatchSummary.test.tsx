import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import useSavedSearchNewMatchSummary from '../useSavedSearchNewMatchSummary';
import axios from '../../utils/axios';

vi.mock('../../utils/axios', () => ({
  default: { get: vi.fn() },
}));

const mockedAxios = axios as unknown as { get: ReturnType<typeof vi.fn> };

afterEach(() => {
  vi.clearAllMocks();
});

describe('useSavedSearchNewMatchSummary', () => {
  it('does not fetch when disabled', () => {
    const { result } = renderHook(() => useSavedSearchNewMatchSummary(false));

    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(result.current).toEqual({
      totalNewMatches: 0,
      hasSavedSearches: false,
      isLoading: false,
    });
  });

  it('sums new-match counts across the account saved searches when enabled', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        savedSearches: [{ newMatchCount: 2 }, { newMatchCount: 3 }, { newMatchCount: null }],
      },
    });

    const { result } = renderHook(() => useSavedSearchNewMatchSummary(true));

    await waitFor(() => expect(result.current.totalNewMatches).toBe(5));
    expect(result.current.hasSavedSearches).toBe(true);
    expect(mockedAxios.get).toHaveBeenCalledWith('/users/savedSearches', {
      withCredentials: true,
    });
  });

  it('fails safe to zero when the request errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockedAxios.get.mockRejectedValueOnce(new Error('offline'));

    const { result } = renderHook(() => useSavedSearchNewMatchSummary(true));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.totalNewMatches).toBe(0);
    expect(result.current.hasSavedSearches).toBe(false);
  });
});
