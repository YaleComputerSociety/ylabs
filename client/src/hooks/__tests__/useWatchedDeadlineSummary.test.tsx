import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import useWatchedDeadlineSummary from '../useWatchedDeadlineSummary';
import axios from '../../utils/axios';

vi.mock('../../utils/axios', () => ({
  default: { get: vi.fn() },
}));

const mockedAxios = axios as unknown as { get: ReturnType<typeof vi.fn> };

const farFuture = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
const beyondWindow = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000).toISOString();

const mockWatched = () => {
  mockedAxios.get.mockImplementation((url: string) => {
    if (url === '/users/watchedPrograms') {
      return Promise.resolve({
        data: {
          watchedPrograms: [
            { _id: 'p1', title: 'STARS', deadline: farFuture },
            { _id: 'p2', title: 'Travel', deadline: beyondWindow },
            { _id: 'p3', title: 'Rolling', deadline: null },
          ],
        },
      });
    }
    if (url === '/users/watchedProgramPlans') {
      return Promise.resolve({
        data: { watchedProgramPlans: { p1: { stage: 'SAVED' }, p2: { stage: 'CONTACTED' } } },
      });
    }
    return Promise.resolve({ data: {} });
  });
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('useWatchedDeadlineSummary', () => {
  it('does not fetch when disabled', () => {
    const { result } = renderHook(() => useWatchedDeadlineSummary(false));

    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({
      approachingCount: 0,
      notStartedCount: 0,
      hasWatchedPrograms: false,
      isLoading: false,
    });
  });

  it('summarizes near-term watched deadlines when enabled', async () => {
    mockWatched();

    const { result } = renderHook(() => useWatchedDeadlineSummary(true));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.approachingCount).toBe(1);
    expect(result.current.notStartedCount).toBe(1);
    expect(result.current.hasWatchedPrograms).toBe(true);
    expect(mockedAxios.get).toHaveBeenCalledWith('/users/watchedPrograms', {
      withCredentials: true,
    });
    expect(mockedAxios.get).toHaveBeenCalledWith('/users/watchedProgramPlans', {
      withCredentials: true,
    });
  });

  it('fails safe to an empty summary when the request errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockedAxios.get.mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useWatchedDeadlineSummary(true));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.approachingCount).toBe(0);
    expect(result.current.hasWatchedPrograms).toBe(false);
  });
});
