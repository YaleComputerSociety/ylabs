import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
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
  default: () => <div />,
}));

vi.mock('../../components/admin/AdminListingEditModal', () => ({
  default: () => <div />,
}));

vi.mock('sweetalert', () => ({
  default: vi.fn(),
}));

const mockedAxiosGet = vi.mocked(axios.get);

describe('Home public research detail route', () => {
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
});
