import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import SearchContext, { defaultSearchContext } from '../../contexts/SearchContext';
import UserContext from '../../contexts/UserContext';
import axios from '../../utils/axios';
import Home from '../home';

vi.mock('../../utils/axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

vi.mock('../../hooks/useInfiniteScroll', () => ({
  useInfiniteScroll: () => ({ current: null }),
}));

vi.mock('../../components/shared/BrowseGrid', () => ({
  default: () => <div />,
}));

vi.mock('../../components/shared/ListingDetailModal', () => ({
  default: ({ isOpen, listing, onNavigateToResearchArea }: any) =>
    isOpen ? (
      <div>
        {listing?.evidence?.summary && <span>{listing.evidence.summary}</span>}
        <button type="button" onClick={() => onNavigateToResearchArea('Artificial Intelligence')}>
          Artificial Intelligence
        </button>
      </div>
    ) : null,
}));

vi.mock('../../components/admin/AdminListingEditModal', () => ({
  default: () => <div />,
}));

vi.mock('sweetalert', () => ({
  default: vi.fn(),
}));

const mockedAxiosGet = vi.mocked(axios.get);

const LocationDisplay = () => {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
};

describe('Home public research detail route', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mockedAxiosGet.mockReset();
    mockedAxiosGet.mockImplementation((url: string) => {
      if (url === '/users/favListingsIds') {
        return Promise.resolve({ data: { favListingsIds: [] } });
      }

      if (url.endsWith('/contact')) {
        return Promise.resolve({
          data: {
            listing: {
              _id: '507f1f77bcf86cd799439011',
              title: 'Public research listing',
              ownerEmail: 'ada@yale.edu',
            },
          },
        });
      }

      return Promise.resolve({
        data: {
          listing: {
            _id: '507f1f77bcf86cd799439011',
            title: 'Public research listing',
          },
        },
      });
    });
  });

  it('loads share URLs through the public detail endpoint for authenticated users', async () => {
    const slug = 'public-research-507f1f77bcf86cd799439011';

    render(
      <MemoryRouter initialEntries={[`/research/${slug}`]}>
        <UserContext.Provider
          value={{
            isLoading: false,
            isAuthenticated: true,
            user: { userType: 'student' } as any,
            checkContext: vi.fn(),
          }}
        >
          <SearchContext.Provider
            value={{
              ...defaultSearchContext,
              refreshListings: vi.fn(),
              setQueryString: vi.fn(),
            }}
          >
            <Routes>
              <Route path="/research/:slug" element={<Home />} />
            </Routes>
          </SearchContext.Provider>
        </UserContext.Provider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mockedAxiosGet).toHaveBeenCalledWith(`/research/${slug}`, { withCredentials: true });
    });

    await waitFor(() => {
      expect(mockedAxiosGet).toHaveBeenCalledWith(`/research/${slug}/contact`, {
        withCredentials: true,
      });
    });

    expect(mockedAxiosGet).not.toHaveBeenCalledWith('/listings/507f1f77bcf86cd799439011', {
      withCredentials: true,
    });
  });

  it('preserves public evidence metadata from detail responses for the modal', async () => {
    const slug = 'public-research-507f1f77bcf86cd799439011';

    mockedAxiosGet.mockImplementation((url: string) => {
      if (url === '/users/favListingsIds') {
        return Promise.resolve({ data: { favListingsIds: [] } });
      }

      return Promise.resolve({
        data: {
          listing: {
            _id: '507f1f77bcf86cd799439011',
            title: 'Public research listing',
            evidence: {
              status: 'available',
              summary: 'Matched from public source metadata.',
              sources: [{ label: 'Faculty profile', url: 'https://example.edu/profile' }],
            },
          },
        },
      });
    });

    render(
      <MemoryRouter initialEntries={[`/research/${slug}`]}>
        <UserContext.Provider
          value={{
            isLoading: false,
            isAuthenticated: false,
            user: null,
            checkContext: vi.fn(),
          }}
        >
          <SearchContext.Provider
            value={{
              ...defaultSearchContext,
              refreshListings: vi.fn(),
              setQueryString: vi.fn(),
            }}
          >
            <Routes>
              <Route path="/research/:slug" element={<Home />} />
            </Routes>
          </SearchContext.Provider>
        </UserContext.Provider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Matched from public source metadata.')).toBeTruthy();
  });

  it('clears share URL slug when navigating to a research area from the modal', async () => {
    const slug = 'public-research-507f1f77bcf86cd799439011';
    const setSelectedListingResearchAreas = vi.fn();

    render(
      <MemoryRouter initialEntries={[`/research/${slug}`]}>
        <UserContext.Provider
          value={{
            isLoading: false,
            isAuthenticated: false,
            user: null,
            checkContext: vi.fn(),
          }}
        >
          <SearchContext.Provider
            value={{
              ...defaultSearchContext,
              refreshListings: vi.fn(),
              setQueryString: vi.fn(),
              setSelectedDepartments: vi.fn(),
              setSelectedResearchAreas: vi.fn(),
              setSelectedListingResearchAreas,
            }}
          >
            <Routes>
              <Route
                path="/research/:slug"
                element={
                  <>
                    <LocationDisplay />
                    <Home />
                  </>
                }
              />
              <Route
                path="/research"
                element={
                  <>
                    <LocationDisplay />
                    <Home />
                  </>
                }
              />
            </Routes>
          </SearchContext.Provider>
        </UserContext.Provider>
      </MemoryRouter>,
    );

    await screen.findByRole('button', { name: 'Artificial Intelligence' });
    fireEvent.click(screen.getByRole('button', { name: 'Artificial Intelligence' }));

    expect(setSelectedListingResearchAreas).toHaveBeenCalledWith(['Artificial Intelligence']);
    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe('/research');
    });
  });
});
