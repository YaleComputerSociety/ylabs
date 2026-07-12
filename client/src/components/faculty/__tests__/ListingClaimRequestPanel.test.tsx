import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ListingClaimRequestPanel from '../ListingClaimRequestPanel';
import axios from '../../../utils/axios';

vi.mock('../../../utils/axios', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

const listing = {
  id: '507f1f77bcf86cd799439011',
  title: 'Cell Systems Lab',
} as any;

describe('ListingClaimRequestPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(axios.get).mockResolvedValue({ data: { requests: [] } });
  });

  it('submits structured correction details and reports non-mutating review', async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: { request: { _id: 'request-1' } } });
    render(<ListingClaimRequestPanel listing={listing} />);

    fireEvent.click(screen.getByRole('button', { name: /claim this listing/i }));
    fireEvent.change(screen.getByLabelText('Details'), {
      target: { value: 'The listed research area is outdated.' },
    });
    fireEvent.change(screen.getByLabelText(/Evidence links/), {
      target: { value: 'https://example.yale.edu/current' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));

    await waitFor(() =>
      expect(axios.post).toHaveBeenCalledWith(`/listings/${listing.id}/claim`, {
        requestType: 'correction',
        message: 'The listed research area is outdated.',
        evidenceUrls: ['https://example.yale.edu/current'],
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('No listing changes were made');
  });

  it('announces duplicate pending requests', async () => {
    vi.mocked(axios.post).mockRejectedValue({ response: { status: 409 } });
    render(<ListingClaimRequestPanel listing={listing} />);
    fireEvent.click(screen.getByRole('button', { name: /claim this listing/i }));
    fireEvent.change(screen.getByLabelText('Details'), { target: { value: 'Please review.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(await screen.findByRole('status')).toHaveTextContent('already have a pending request');
  });
});
