import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import useFavorites from '../useFavorites';
import axios from '../../utils/axios';
import swal from 'sweetalert';

vi.mock('../../utils/axios', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('sweetalert', () => ({
  default: vi.fn(),
}));

const mockedAxios = axios as unknown as {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

const mockedSwal = swal as unknown as ReturnType<typeof vi.fn>;

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('useFavorites', () => {
  it('does not block the page with a modal when listing favorites fail to load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedAxios.get.mockRejectedValueOnce(new Error('favorites unavailable'));

    const { result } = renderHook(() => useFavorites('listings'));

    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith('/users/favListingsIds', {
        withCredentials: true,
      });
    });

    expect(result.current.favIds).toEqual([]);
    expect(mockedSwal).not.toHaveBeenCalled();
  });

  it('uses saved program endpoints for canonical program favorites', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { savedProgramIds: ['program-1'] } });

    const { result } = renderHook(() => useFavorites('programs'));

    await waitFor(() => {
      expect(result.current.favIds).toEqual(['program-1']);
    });

    expect(mockedAxios.get).toHaveBeenCalledWith('/users/savedProgramIds', {
      withCredentials: true,
    });
  });

  it('uses saved research plan endpoints for canonical research plan favorites', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { savedResearchEntityIds: ['entity-1'] } });

    const { result } = renderHook(() => useFavorites('researchPlans'));

    await waitFor(() => {
      expect(result.current.favIds).toEqual(['entity-1']);
    });

    expect(mockedAxios.get).toHaveBeenCalledWith('/users/savedResearchEntityIds', {
      withCredentials: true,
    });
  });

  it('records a save only after the canonical entity mutation succeeds', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { savedResearchEntityIds: [] } });
    mockedAxios.put.mockResolvedValueOnce({ data: { savedResearchEntityIds: ['entity-1'] } });
    mockedAxios.post.mockResolvedValueOnce({ status: 202 });
    const { result } = renderHook(() => useFavorites('researchPlans'));
    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalled());

    await act(async () => {
      await result.current.setFavorite('entity-1', true);
    });

    expect(mockedAxios.post).toHaveBeenCalledWith(
      '/analytics/research',
      expect.objectContaining({
        eventType: 'research_save',
        entityType: 'research_entity',
        entityId: 'entity-1',
        payload: { operation: 'save', surface: 'profile' },
      }),
      { withCredentials: true },
    );
  });

  it('does not record a save when the canonical mutation fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockedAxios.get.mockResolvedValueOnce({ data: { savedResearchEntityIds: [] } });
    mockedAxios.put.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useFavorites('researchPlans'));
    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalled());

    await act(async () => {
      await result.current.setFavorite('entity-1', true);
    });

    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});
