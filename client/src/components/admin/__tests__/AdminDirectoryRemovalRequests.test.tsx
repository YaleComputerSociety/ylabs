import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AdminDirectoryRemovalRequests from '../AdminDirectoryRemovalRequests';
import axios from '../../../utils/axios';

vi.mock('../../../utils/axios', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
  },
}));

const csrfMock = vi.hoisted(() => ({
  sessionCsrfHeaders: vi.fn(async () => ({ 'X-CSRF-Token': 't'.repeat(64) })),
}));
vi.mock('../../../utils/sessionCsrf', () => csrfMock);

const mockedAxios = axios as unknown as {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
};

const pendingRequest = {
  _id: 'req1',
  requesterNetid: 'zz9xxx',
  researcherId: 'researcher1',
  researcherDisplayName: 'Synthetic Listed Person',
  status: 'pending',
  createdAt: '2026-11-01T12:00:00.000Z',
  decidedAt: null,
  decidedBy: null,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AdminDirectoryRemovalRequests', () => {
  it.each([
    ['Accept', 'accepted'],
    ['Decline', 'declined'],
  ])('%s sends only a status and reloads the queue', async (action, status) => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: { requests: [pendingRequest], total: 1 } })
      .mockResolvedValueOnce({ data: { requests: [], total: 0 } });
    mockedAxios.put.mockResolvedValue({ data: {} });
    render(<AdminDirectoryRemovalRequests />);

    expect(await screen.findByText('Synthetic Listed Person')).toBeTruthy();
    expect(mockedAxios.get.mock.calls[0][0]).toBe(
      '/admin/directory-removal-requests?status=pending',
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: `${action} removal request for Synthetic Listed Person`,
      }),
    );

    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalledTimes(2));
    expect(mockedAxios.put).toHaveBeenCalledWith(
      '/admin/directory-removal-requests/req1',
      { status },
      { headers: { 'X-CSRF-Token': 't'.repeat(64) } },
    );
    expect(await screen.findByText('No pending requests.')).toBeTruthy();
  });

  it('shows a failed decision and keeps the request listed', async () => {
    mockedAxios.get.mockResolvedValue({ data: { requests: [pendingRequest], total: 1 } });
    mockedAxios.put.mockRejectedValue({
      response: { data: { error: 'This request has already been decided.' } },
    });
    render(<AdminDirectoryRemovalRequests />);

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Accept removal request for Synthetic Listed Person',
      }),
    );
    expect((await screen.findByRole('alert')).textContent).toBe(
      'This request has already been decided.',
    );
    expect(screen.getByText('Synthetic Listed Person')).toBeTruthy();
  });

  it('offers a retry when the queue cannot load', async () => {
    mockedAxios.get
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ data: { requests: [], total: 0 } });
    render(<AdminDirectoryRemovalRequests />);

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Could not load removal requests.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No pending requests.')).toBeTruthy();
  });
});
