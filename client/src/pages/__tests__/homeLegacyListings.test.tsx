import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SearchContext, { defaultSearchContext } from '../../contexts/SearchContext';
import UserContext from '../../contexts/UserContext';
import Home from '../home';

vi.mock('../../components/shared/BrowseGrid', () => ({
  default: () => <div data-testid="browse-grid" />,
}));

vi.mock('../../components/shared/ListingDetailModal', () => ({
  default: () => null,
}));

vi.mock('../../components/admin/AdminListingEditModal', () => ({
  default: () => null,
}));

vi.mock('../../hooks/useInfiniteScroll', () => ({
  useInfiniteScroll: () => ({ current: null }),
}));

vi.mock('../../utils/axios', () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: { favListingsIds: [] } })),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('sweetalert', () => ({
  default: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('legacy listings page', () => {
  it('frames the old listings board as Posted Roles and points back to Research and Pathways', () => {
    render(
      <MemoryRouter initialEntries={['/listings']}>
        <UserContext.Provider
          value={{
            isLoading: false,
            isAuthenticated: true,
            user: { netId: 'student1', userType: 'student' } as any,
            checkContext: vi.fn(),
          }}
        >
          <SearchContext.Provider
            value={{
              ...defaultSearchContext,
              refreshListings: vi.fn(),
            }}
          >
            <Home />
          </SearchContext.Provider>
        </UserContext.Provider>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Posted Roles' })).toBeTruthy();
    expect(
      screen.getByText(/Posted roles are now one part of Yale Research/i),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Explore research homes' }).getAttribute('href')).toBe(
      '/research',
    );
    expect(screen.getByRole('link', { name: 'Browse pathways' }).getAttribute('href')).toBe(
      '/pathways',
    );
  });
});
