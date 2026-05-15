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
});
