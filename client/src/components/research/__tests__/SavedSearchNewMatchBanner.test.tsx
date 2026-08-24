import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SavedSearchNewMatchBanner from '../SavedSearchNewMatchBanner';
import axios from '../../../utils/axios';

vi.mock('../../../utils/axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

const mockedAxios = axios as unknown as { get: ReturnType<typeof vi.fn> };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SavedSearchNewMatchBanner', () => {
  it('links to the saved-searches account surface when there are unseen matches', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { savedSearches: [{ _id: 'a', newMatchCount: 3 }] },
    });

    render(
      <MemoryRouter>
        <SavedSearchNewMatchBanner enabled />
      </MemoryRouter>,
    );

    const link = await screen.findByRole('link', { name: /View saved searches/i });
    expect(screen.getByText('3 new matches for your saved searches')).toBeTruthy();
    expect(link.getAttribute('href')).toBe('/account');
  });

  it('renders nothing when there are no unseen matches', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { savedSearches: [{ _id: 'a', newMatchCount: 0 }] },
    });

    const { container } = render(
      <MemoryRouter>
        <SavedSearchNewMatchBanner enabled />
      </MemoryRouter>,
    );

    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('renders nothing when the student has no saved searches', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { savedSearches: [] } });

    const { container } = render(
      <MemoryRouter>
        <SavedSearchNewMatchBanner enabled />
      </MemoryRouter>,
    );

    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('does not fetch when disabled (logged out)', () => {
    const { container } = render(
      <MemoryRouter>
        <SavedSearchNewMatchBanner enabled={false} />
      </MemoryRouter>,
    );

    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(container.textContent).toBe('');
  });

  it('uses singular phrasing for exactly one new match', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { savedSearches: [{ _id: 'a', newMatchCount: 1 }] },
    });

    render(
      <MemoryRouter>
        <SavedSearchNewMatchBanner enabled />
      </MemoryRouter>,
    );

    expect(await screen.findByText('1 new match for your saved searches')).toBeTruthy();
  });
});
