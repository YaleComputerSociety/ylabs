import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import FellowshipSearchContext from '../../contexts/FellowshipSearchContext';
import UserContext from '../../contexts/UserContext';
import FellowshipSearchContextProvider from '../FellowshipSearchContextProvider';
import axios from '../../utils/axios';

vi.mock('../../utils/axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

vi.mock('sweetalert', () => ({
  default: vi.fn(),
}));

const mockedAxios = axios as unknown as {
  get: ReturnType<typeof vi.fn>;
};

const renderProvider = (userType: 'student' | 'admin' = 'student') =>
  render(
    <MemoryRouter initialEntries={['/programs']}>
      <UserContext.Provider
        value={{
          isLoading: false,
          isAuthenticated: true,
          user: { userType } as any,
          checkContext: vi.fn(),
        }}
      >
        <FellowshipSearchContextProvider>
          <FellowshipSearchContext.Consumer>
            {(context) => (
              <div>
                <p data-testid="program-kind-count">{context.filterOptions.programKind.length}</p>
                <p data-testid="cycle-summary">{JSON.stringify(context.cycleSummary)}</p>
                <button
                  type="button"
                  onClick={() => context.setSelectedProgramKind(['STRUCTURED_PROGRAM'])}
                >
                  Structured only
                </button>
                <button
                  type="button"
                  onClick={() => context.setSelectedStudentVisibilityTier(['operator_review'])}
                >
                  Review tier
                </button>
              </div>
            )}
          </FellowshipSearchContext.Consumer>
        </FellowshipSearchContextProvider>
      </UserContext.Provider>
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('FellowshipSearchContextProvider program routes', () => {
  it('loads filters and initial results from /programs endpoints', async () => {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url === '/programs/filters') {
        return Promise.resolve({
          data: {
            programKind: ['STRUCTURED_PROGRAM'],
            entryMode: ['APPLY_TO_PROGRAM'],
            studentFacingCategory: ['Structured program'],
          },
        });
      }
      return Promise.resolve({ data: { results: [], total: 0 } });
    });

    renderProvider();

    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith('/programs/filters');
    });
    await waitFor(() => {
      expect(screen.getByTestId('program-kind-count').textContent).toBe('1');
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('/programs/search?query=&page=1&pageSize=100'),
      );
    });
  });

  it('derives the cycle summary from the full paginated result set, not one page', async () => {
    const makeRecord = (index: number) => ({
      _id: `program-${index}`,
      title: `Program ${index}`,
      isAcceptingApplications: false,
    });
    const total = 133;
    const pageSize = 100;

    mockedAxios.get.mockImplementation((url: string) => {
      if (url === '/programs/filters') {
        return Promise.resolve({ data: {} });
      }
      const pageMatch = url.match(/[?&]page=(\d+)/);
      const requestedPage = pageMatch ? Number(pageMatch[1]) : 1;
      const start = (requestedPage - 1) * pageSize;
      const results = Array.from({ length: Math.max(0, Math.min(pageSize, total - start)) }, (_, i) =>
        makeRecord(start + i),
      );
      return Promise.resolve({ data: { results, total } });
    });

    renderProvider();

    await waitFor(() => {
      expect(JSON.parse(screen.getByTestId('cycle-summary').textContent || '{}')).toEqual({
        open: 0,
        closingSoon: 0,
        nextCycle: 0,
        closed: total,
      });
    });

    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining('/programs/search?query=&page=2&pageSize=100'),
    );
  });

  it('sends admin-only student visibility params when the admin filter is selected', async () => {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url === '/programs/filters') {
        return Promise.resolve({ data: {} });
      }
      return Promise.resolve({ data: { results: [], total: 0 } });
    });

    renderProvider('admin');

    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith('/programs/filters');
    });
    await userEvent.click(screen.getByRole('button', { name: 'Review tier' }));

    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('studentVisibilityTier=operator_review'),
      );
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('includeOperatorReview=true'),
      );
    });
  });
});
