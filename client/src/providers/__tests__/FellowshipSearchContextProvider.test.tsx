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
    <MemoryRouter
      initialEntries={['/programs']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
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
                <button
                  type="button"
                  onClick={() => context.setSelectedProgramKind(['STRUCTURED_PROGRAM'])}
                >
                  Structured only
                </button>
                <button
                  type="button"
                  onClick={() =>
                    context.setSelectedStudentVisibilityTier(['operator_review'])
                  }
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
        expect.stringContaining('/programs/search?query=&page=1&pageSize=500'),
      );
    });
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
