import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
});
