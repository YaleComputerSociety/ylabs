import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import useFavorites from '../useFavorites';
import axios from '../../utils/axios';
import swal from 'sweetalert';

vi.mock('../../utils/axios', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('sweetalert', () => ({
  default: vi.fn(),
}));

const mockedAxios = axios as unknown as {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
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
});
