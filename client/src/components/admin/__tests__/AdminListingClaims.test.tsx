import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AdminListingClaims from '../AdminListingClaims';
import axios from '../../../utils/axios';

vi.mock('../../../utils/axios', () => ({
  default: { get: vi.fn(), put: vi.fn() },
}));

const mockedAxios = axios as unknown as {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const approvedClaim = {
  _id: 'claim-1',
  requestType: 'correction' as const,
  status: 'approved' as const,
  message: 'This description is wrong.',
  evidenceUrls: [],
  listingSnapshot: { title: 'Test Lab Listing' },
  requester: {
    name: 'Test Faculty',
    userType: 'faculty',
    userConfirmed: true,
    profileVerified: true,
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  proposedChanges: { description: 'The corrected full description.' },
  applyStatus: 'not_applicable' as const,
};

describe('AdminListingClaims apply action', () => {
  it('applies an approved correction to canonical data and shows success state', async () => {
    mockedAxios.get.mockResolvedValue({ data: { requests: [approvedClaim], total: 1 } });
    mockedAxios.put.mockResolvedValue({
      data: {
        request: {
          ...approvedClaim,
          applyStatus: 'applied',
          appliedFields: ['description'],
        },
      },
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<AdminListingClaims />);

    fireEvent.click(await screen.findByText('Test Lab Listing'));
    expect(screen.getByText(/The corrected full description\./)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Apply to canonical data' }));

    await waitFor(() => {
      expect(mockedAxios.put).toHaveBeenCalledWith('/admin/listing-claims/claim-1/apply', {
        confirmApply: true,
      });
    });

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Applied to canonical data: description.',
    );
  });

  it('shows the apply failure state without hiding the request', async () => {
    mockedAxios.get.mockResolvedValue({ data: { requests: [approvedClaim], total: 1 } });
    mockedAxios.put.mockRejectedValue({
      response: { data: { error: 'No linked canonical research entity to apply changes to.' } },
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<AdminListingClaims />);

    fireEvent.click(await screen.findByText('Test Lab Listing'));
    fireEvent.click(screen.getByRole('button', { name: 'Apply to canonical data' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No linked canonical research entity to apply changes to.',
    );
  });

  it('does not apply when the reviewer declines the confirmation prompt', async () => {
    mockedAxios.get.mockResolvedValue({ data: { requests: [approvedClaim], total: 1 } });
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<AdminListingClaims />);

    fireEvent.click(await screen.findByText('Test Lab Listing'));
    fireEvent.click(screen.getByRole('button', { name: 'Apply to canonical data' }));

    expect(mockedAxios.put).not.toHaveBeenCalled();
  });
});
