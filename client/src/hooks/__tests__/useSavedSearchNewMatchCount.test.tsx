import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import useSavedSearchNewMatchCount from '../useSavedSearchNewMatchCount';
import axios from '../../utils/axios';

vi.mock('../../utils/axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

const mockedAxios = axios as unknown as { get: ReturnType<typeof vi.fn> };

afterEach(() => {
  vi.clearAllMocks();
});

describe('useSavedSearchNewMatchCount', () => {
  it('sums unseen new-match counts across saved searches', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        savedSearches: [
          { _id: 'a', newMatchCount: 2 },
          { _id: 'b', newMatchCount: 1 },
        ],
      },
    });

    const { result } = renderHook(() => useSavedSearchNewMatchCount());

    await waitFor(() => expect(result.current).toBe(3));
    expect(mockedAxios.get).toHaveBeenCalledWith('/users/savedSearches', {
      withCredentials: true,
    });
  });

  it('ignores null new-match counts and clamps negatives to zero', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        savedSearches: [
          { _id: 'a', newMatchCount: null },
          { _id: 'b', newMatchCount: -3 },
        ],
      },
    });

    const { result } = renderHook(() => useSavedSearchNewMatchCount());

    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalled());
    expect(result.current).toBe(0);
  });

  it('does not fetch when disabled', () => {
    renderHook(() => useSavedSearchNewMatchCount({ enabled: false }));

    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('fails safe to zero when the request errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockedAxios.get.mockRejectedValueOnce(new Error('offline'));

    const { result } = renderHook(() => useSavedSearchNewMatchCount());

    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalled());
    expect(result.current).toBe(0);
  });
});
