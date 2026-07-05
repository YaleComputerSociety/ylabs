import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
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

const PublicResearchControls = () => {
  const location = useLocation();
  const {
    queryString,
    selectedDepartments,
    selectedListingResearchAreas,
    setQueryString,
    setSelectedDepartments,
    setSelectedListingResearchAreas,
    setListingResearchAreasFilterMode,
    setSortBy,
    onToggleSortDirection,
    setQuickFilter,
  } = React.useContext(SearchContext);

  return (
    <div>
      <div data-testid="query">{queryString}</div>
      <div data-testid="departments">{selectedDepartments.join('|')}</div>
      <div data-testid="research-areas">{selectedListingResearchAreas.join('|')}</div>
      <div data-testid="search">{location.search}</div>
      <button type="button" onClick={() => setQueryString('genomics')}>
        query
      </button>
      <button type="button" onClick={() => setSelectedDepartments(['Computer Science'])}>
        department
      </button>
      <button
        type="button"
        onClick={() => {
          setSelectedListingResearchAreas(['AI', 'Genomics']);
          setListingResearchAreasFilterMode('intersection');
        }}
      >
        areas
      </button>
      <button
        type="button"
        onClick={() => {
          setSortBy('updatedAt');
          onToggleSortDirection();
        }}
      >
        sort
      </button>
      <button type="button" onClick={() => setQuickFilter('open')}>
        quick
      </button>
    </div>
  );
};

const renderProvider = (initialEntry: string, isAuthenticated = true) =>
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <UserContext.Provider
        value={{
          isLoading: false,
          isAuthenticated,
          user: isAuthenticated ? ({ userType: 'student' } as any) : null,
          checkContext: vi.fn(),
        }}
      >
        <SearchContextProvider>
          <PublicResearchControls />
        </SearchContextProvider>
      </UserContext.Provider>
    </MemoryRouter>,
  );

describe('SearchContextProvider public research route', () => {
  beforeEach(() => {
    mockedAxiosGet.mockReset();
    mockedAxiosGet.mockResolvedValue({ data: { results: [], totalCount: 0 } });
  });

  it('uses the public search endpoint on research routes for authenticated users', async () => {
    renderProvider('/research');

    await waitFor(() => {
      expect(mockedAxiosGet).toHaveBeenCalledWith(
        '/research?query=&page=1&pageSize=20&departmentsMode=union&academicDisciplinesMode=union&researchAreasMode=union',
      );
    });

    expect(mockedAxiosGet).not.toHaveBeenCalledWith(
      '/listings/search?query=&page=1&pageSize=20&departmentsMode=union&academicDisciplinesMode=union&researchAreasMode=union',
    );
  });

  it('restores shareable public research URLs before searching', async () => {
    renderProvider(
      '/research?query=cell%20signaling&departments=Computer%20Science%7C%7CBiology&researchAreas=Genomics,AI&researchAreasMode=intersection&sortBy=updatedAt&sortOrder=-1&quickFilter=open',
      false,
    );

    await waitFor(() => {
      expect(screen.getByTestId('query').textContent).toBe('cell signaling');
    });
    expect(screen.getByTestId('departments').textContent).toBe('Computer Science|Biology');
    expect(screen.getByTestId('research-areas').textContent).toBe('Genomics|AI');

    await waitFor(() => {
      expect(mockedAxiosGet).toHaveBeenCalledWith(
        '/research?query=cell%20signaling&page=1&pageSize=20&sortBy=updatedAt&sortOrder=-1&departments=Computer%20Science%7C%7CBiology&researchAreas=Genomics%2CAI&departmentsMode=union&academicDisciplinesMode=union&researchAreasMode=intersection',
      );
    });
  });

  it('mirrors public research search state into the URL', async () => {
    renderProvider('/research', false);

    await waitFor(() => {
      expect(mockedAxiosGet).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole('button', { name: 'query' }));
    fireEvent.click(screen.getByRole('button', { name: 'department' }));
    fireEvent.click(screen.getByRole('button', { name: 'areas' }));
    fireEvent.click(screen.getByRole('button', { name: 'sort' }));
    fireEvent.click(screen.getByRole('button', { name: 'quick' }));

    await waitFor(() => {
      expect(screen.getByTestId('search').textContent).toBe(
        '?query=genomics&departments=Computer+Science&researchAreas=AI%2CGenomics&researchAreasMode=intersection&sortBy=updatedAt&sortOrder=-1&quickFilter=open',
      );
    });
  });
});
