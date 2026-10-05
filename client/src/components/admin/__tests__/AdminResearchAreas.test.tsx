import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AdminResearchAreas from '../AdminResearchAreas';
import axios from '../../../utils/axios';

vi.mock('../../../utils/axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../../../utils/appDialogs', () => ({ showAlert: vi.fn(), confirmAction: vi.fn() }));

const mockedAxios = axios as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AdminResearchAreas', () => {
  it('creates a topic through the audited admin API', async () => {
    mockedAxios.get.mockResolvedValue({ data: { researchAreas: [] } });
    mockedAxios.post.mockResolvedValue({ data: {} });

    render(<AdminResearchAreas />);
    await waitFor(() =>
      expect(mockedAxios.get).toHaveBeenCalledWith('/admin/research-areas', {
        withCredentials: true,
      }),
    );

    fireEvent.change(screen.getByPlaceholderText('e.g. Quantum Computing'), {
      target: { value: 'Quantum Computing' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() =>
      expect(mockedAxios.post).toHaveBeenCalledWith(
        '/admin/research-areas',
        { name: 'Quantum Computing', field: 'Computing & Artificial Intelligence' },
        { withCredentials: true },
      ),
    );
  });
});
