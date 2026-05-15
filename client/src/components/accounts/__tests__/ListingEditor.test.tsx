import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import axios from '../../../utils/axios';
import ListingEditor from '../ListingEditor';

vi.mock('../../../utils/axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

vi.mock('sweetalert', () => ({
  default: vi.fn(),
}));

vi.mock('../ListingCard', () => ({
  default: () => <li data-testid="listing-card" />,
}));

vi.mock('../CreateButton', () => ({
  default: () => <button type="button">Create posted role</button>,
}));

const mockedAxios = axios as unknown as {
  get: ReturnType<typeof vi.fn>;
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ListingEditor', () => {
  it('uses Posted Roles language for professor-owned listings management', async () => {
    mockedAxios.get.mockResolvedValue({ data: { ownListings: [] } });

    render(
      <ListingEditor
        user={
          {
            netId: 'prof1',
            userType: 'professor',
            profileVerified: true,
          } as any
        }
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Your Posted Roles' })).toBeTruthy();
    });
    expect(screen.queryByText('Your Listings')).toBeNull();
  });
});
