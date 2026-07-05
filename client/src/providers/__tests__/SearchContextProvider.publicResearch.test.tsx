import React, { useContext } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SearchContext from '../../contexts/SearchContext';
import UserContext from '../../contexts/UserContext';
import axios from '../../utils/axios';
import SearchContextProvider from '../SearchContextProvider';

vi.mock('../../utils/axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

vi.mock('../../hooks/useConfig', () => ({
  useConfig: () => ({
    departments: [],
    departmentCategories: [],
    researchAreas: [],
    isLoaded: true,
  }),
}));

vi.mock('sweetalert', () => ({
  default: vi.fn(),
}));

const mockedAxiosGet = vi.mocked(axios.get);

const EvidenceSummary = () => {
  const { listings } = useContext(SearchContext);
  return <div>{listings[0]?.evidence?.summary || ''}</div>;
};

describe('SearchContextProvider public research route', () => {
  beforeEach(() => {
    mockedAxiosGet.mockReset();
    mockedAxiosGet.mockResolvedValue({ data: { results: [], totalCount: 0 } });
  });

  it('uses the public search endpoint on research routes for authenticated users', async () => {
    render(
      <MemoryRouter initialEntries={['/research']}>
        <UserContext.Provider
          value={{
            isLoading: false,
            isAuthenticated: true,
            user: { userType: 'student' } as any,
            checkContext: vi.fn(),
          }}
        >
          <SearchContextProvider>
            <div />
          </SearchContextProvider>
        </UserContext.Provider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mockedAxiosGet).toHaveBeenCalledWith(
        '/research?query=&page=1&pageSize=20&departmentsMode=union&academicDisciplinesMode=union&researchAreasMode=union',
      );
    });

    expect(mockedAxiosGet).not.toHaveBeenCalledWith(
      '/listings/search?query=&page=1&pageSize=20&departmentsMode=union&academicDisciplinesMode=union&researchAreasMode=union',
    );
  });

  it('preserves evidence metadata from public search results', async () => {
    mockedAxiosGet.mockResolvedValue({
      data: {
        results: [
          {
            _id: '507f1f77bcf86cd799439011',
            title: 'Public research listing',
            evidence: {
              status: 'available',
              summary: 'Matched from public search metadata.',
              sources: [{ label: 'Publication', url: 'https://example.edu/work' }],
            },
          },
        ],
        totalCount: 1,
      },
    });

    render(
      <MemoryRouter initialEntries={['/research']}>
        <UserContext.Provider
          value={{
            isLoading: false,
            isAuthenticated: false,
            user: null,
            checkContext: vi.fn(),
          }}
        >
          <SearchContextProvider>
            <EvidenceSummary />
          </SearchContextProvider>
        </UserContext.Provider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Matched from public search metadata.')).toBeTruthy();
  });
});
