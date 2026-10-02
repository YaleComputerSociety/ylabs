import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import FellowshipSearchContext from '../../contexts/FellowshipSearchContext';
import UserContext from '../../contexts/UserContext';
import FellowshipSearchContextProvider from '../FellowshipSearchContextProvider';
import FellowshipModal from '../../components/fellowship/FellowshipModal';
import { Fellowship } from '../../types/types';
import { createFellowship } from '../../utils/createFellowship';
import axios from '../../utils/axios';

vi.mock('../../utils/axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

vi.mock('../../utils/researchAnalytics', async () => ({
  ...(await vi.importActual<typeof import('../../utils/researchAnalytics')>(
    '../../utils/researchAnalytics',
  )),
  trackResearchEvent: vi.fn(),
}));

vi.mock('../../utils/appDialogs', () => ({ showAlert: vi.fn(), confirmAction: vi.fn() }));

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
          user: { userType, isAdmin: userType === 'admin' } as any,
          checkContext: vi.fn(),
        }}
      >
        <FellowshipSearchContextProvider>
          <FellowshipSearchContext.Consumer>
            {(context) => (
              <div>
                <p data-testid="program-kind-count">{context.filterOptions.programKind.length}</p>
                <p data-testid="fellowship-count">{context.fellowships.length}</p>
                <p data-testid="fellowship-titles">
                  {context.fellowships.map((fellowship) => fellowship.title).join('|')}
                </p>
                <p data-testid="search-exhausted">{String(context.searchExhausted)}</p>
                <p data-testid="load-error">{String(context.loadError)}</p>
                <p data-testid="is-loading">{String(context.isLoading)}</p>
                <button type="button" onClick={context.refreshFellowships}>
                  Retry
                </button>
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

  it('reports loading while the filter options are still pending, before any search is sent', async () => {
    let resolveFilters: (value: unknown) => void = () => {};
    mockedAxios.get.mockImplementation((url: string) => {
      if (url === '/programs/filters') {
        return new Promise((resolve) => {
          resolveFilters = resolve;
        });
      }
      return Promise.resolve({ data: { results: [], total: 0 } });
    });

    renderProvider();

    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith('/programs/filters');
    });
    expect(screen.getByTestId('is-loading').textContent).toBe('true');
    expect(mockedAxios.get).not.toHaveBeenCalledWith(expect.stringContaining('/programs/search'));

    await act(async () => {
      resolveFilters({ data: {} });
    });
    await waitFor(() => {
      expect(screen.getByTestId('is-loading').textContent).toBe('false');
    });
  });

  it('loads the full result set into context on first paint so an apply-now program on a later page is not gated behind pagination', async () => {
    const total = 133;
    const pageSize = 100;
    const openDeadline = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
    const makeRecord = (index: number) =>
      index === total - 1
        ? {
            _id: 'open-late',
            title: 'Open Late Program',
            isAcceptingApplications: true,
            deadline: openDeadline,
          }
        : {
            _id: `program-${index}`,
            title: `Program ${index}`,
            isAcceptingApplications: false,
          };

    mockedAxios.get.mockImplementation((url: string) => {
      if (url === '/programs/filters') {
        return Promise.resolve({ data: {} });
      }
      const pageMatch = url.match(/[?&]page=(\d+)/);
      const requestedPage = pageMatch ? Number(pageMatch[1]) : 1;
      const start = (requestedPage - 1) * pageSize;
      const results = Array.from(
        { length: Math.max(0, Math.min(pageSize, total - start)) },
        (_, i) => makeRecord(start + i),
      );
      return Promise.resolve({ data: { results, total } });
    });

    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId('fellowship-count').textContent).toBe(String(total));
    });

    expect(screen.getByTestId('fellowship-titles').textContent).toContain('Open Late Program');
    expect(screen.getByTestId('search-exhausted').textContent).toBe('true');
    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining('/programs/search?query=&page=2&pageSize=100'),
    );
  });

  it('narrows to only the chosen value when a program modal eligibility chip is clicked', async () => {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url === '/programs/filters') {
        return Promise.resolve({ data: {} });
      }
      return Promise.resolve({ data: { results: [], total: 0 } });
    });
    const program: Fellowship = createFellowship({
      _id: 'program-summer',
      title: 'Synthetic Summer Program',
      termOfAward: ['Summer'],
    });

    render(
      <MemoryRouter initialEntries={['/programs']}>
        <UserContext.Provider
          value={{
            isLoading: false,
            isAuthenticated: true,
            user: { userType: 'student', isAdmin: false } as any,
            checkContext: vi.fn(),
          }}
        >
          <FellowshipSearchContextProvider>
            <FellowshipSearchContext.Consumer>
              {(context) => (
                <div>
                  <p data-testid="quick-filter">{String(context.quickFilter)}</p>
                  <button
                    type="button"
                    onClick={() => {
                      context.setSelectedProgramKind(['STRUCTURED_PROGRAM']);
                      context.setSelectedEntryMode(['APPLY_TO_PROGRAM']);
                      context.setSelectedProgramCategory(['FELLOWSHIP']);
                      context.setSelectedStudentFacingCategory(['Structured program']);
                      context.setSelectedSubjects(['Biology']);
                      context.setSelectedPurpose(['Research']);
                      context.setQuickFilter('open');
                    }}
                  >
                    Narrow earlier
                  </button>
                </div>
              )}
            </FellowshipSearchContext.Consumer>
            <FellowshipModal
              fellowship={program}
              isOpen
              isFavorite={false}
              onClose={vi.fn()}
              toggleFavorite={vi.fn()}
            />
          </FellowshipSearchContextProvider>
        </UserContext.Provider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith('/programs/filters');
    });
    await userEvent.click(screen.getByRole('button', { name: 'Narrow earlier', hidden: true }));
    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith(expect.stringContaining('programKind='));
    });
    await userEvent.click(screen.getByRole('button', { name: 'Summer' }));

    await waitFor(() => {
      const searchUrls = mockedAxios.get.mock.calls
        .map(([url]) => String(url))
        .filter((url) => url.startsWith('/programs/search'));
      const latestSearch = new URL(searchUrls[searchUrls.length - 1], 'https://example.test');
      const appliedFilters = [...latestSearch.searchParams.keys()].filter(
        (key) => !['query', 'page', 'pageSize'].includes(key),
      );
      expect(appliedFilters).toEqual(['termOfAward']);
      expect(latestSearch.searchParams.get('termOfAward')).toBe('Summer');
    });
    expect(screen.getByTestId('quick-filter').textContent).toBe('null');
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

  it('returns to the top when a filter change starts a new search, but not on first load', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    mockedAxios.get.mockImplementation((url: string) => {
      if (url === '/programs/filters') {
        return Promise.resolve({ data: {} });
      }
      return Promise.resolve({ data: { results: [], total: 0 } });
    });

    renderProvider();

    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith(expect.stringContaining('/programs/search'));
    });
    expect(scrollTo).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Structured only' }));

    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
    });
    scrollTo.mockRestore();
  });

  describe('when a search request fails', () => {
    const fundingRow = {
      _id: 'synthetic-funding',
      title: 'Synthetic Funding',
      programKind: 'FELLOWSHIP_FUNDING',
      isAcceptingApplications: false,
    };
    const structuredRow = {
      _id: 'synthetic-structured',
      title: 'Synthetic Structured',
      programKind: 'STRUCTURED_PROGRAM',
      isAcceptingApplications: false,
    };

    const serveSearches = (control: { fail: boolean }) => {
      mockedAxios.get.mockImplementation((url: string) => {
        if (url === '/programs/filters') {
          return Promise.resolve({ data: {} });
        }
        if (control.fail) {
          return Promise.reject(new Error('network'));
        }
        const rows = url.includes('programKind=STRUCTURED_PROGRAM')
          ? [structuredRow]
          : [fundingRow, structuredRow];
        return Promise.resolve({ data: { results: rows, total: rows.length } });
      });
    };

    it('does not keep serving the previous unfiltered list with zeroed tiles', async () => {
      const control = { fail: false };
      serveSearches(control);

      renderProvider();
      await waitFor(() => expect(screen.getByTestId('fellowship-count').textContent).toBe('2'));
      const searchesBefore = mockedAxios.get.mock.calls.length;

      control.fail = true;
      await userEvent.click(screen.getByRole('button', { name: 'Structured only' }));

      await waitFor(() =>
        expect(mockedAxios.get.mock.calls.length).toBeGreaterThan(searchesBefore),
      );
      await waitFor(() => expect(screen.getByTestId('is-loading').textContent).toBe('false'));
      expect({
        staleUnfilteredRowShown: (
          screen.getByTestId('fellowship-titles').textContent || ''
        ).includes('Synthetic Funding'),
        loadError: screen.getByTestId('load-error').textContent,
      }).toEqual({ staleUnfilteredRowShown: false, loadError: 'true' });
    });

    it('reports a failed first load as an error and clears it on a successful retry', async () => {
      const control = { fail: true };
      serveSearches(control);

      renderProvider();
      await waitFor(() => expect(screen.getByTestId('load-error').textContent).toBe('true'));
      expect(screen.getByTestId('fellowship-count').textContent).toBe('0');

      control.fail = false;
      await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

      await waitFor(() => expect(screen.getByTestId('fellowship-count').textContent).toBe('2'));
      expect(screen.getByTestId('load-error').textContent).toBe('false');
    });
  });

  describe('on a single visit to /programs', () => {
    const firstPageSearchCount = () =>
      mockedAxios.get.mock.calls.filter(([url]) =>
        String(url).startsWith('/programs/search?query=&page=1&'),
      ).length;

    afterEach(() => {
      vi.useRealTimers();
    });

    it('sends one first-page search once filter options load, with no follow-up from lifecycle flags', async () => {
      vi.useFakeTimers();
      mockedAxios.get.mockImplementation((url: string) => {
        if (url === '/programs/filters') return Promise.resolve({ data: {} });
        return Promise.resolve({ data: { results: [], total: 0 } });
      });

      renderProvider();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(firstPageSearchCount()).toBe(1);
    });

    it('keeps a failed first load an error without refetching the same parameters', async () => {
      vi.useFakeTimers();
      mockedAxios.get.mockImplementation((url: string) => {
        if (url === '/programs/filters') return Promise.resolve({ data: {} });
        return Promise.reject(new Error('network'));
      });

      renderProvider();
      const loadErrorSamples: string[] = [];
      for (let elapsed = 0; elapsed < 1500; elapsed += 50) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(50);
        });
        loadErrorSamples.push(screen.getByTestId('load-error').textContent || '');
      }

      const firstError = loadErrorSamples.indexOf('true');
      expect(firstError).toBeGreaterThanOrEqual(0);
      expect(loadErrorSamples.slice(firstError).every((sample) => sample === 'true')).toBe(true);
      expect(firstPageSearchCount()).toBe(1);
    });

    it('searches again only when the query text changes, after the debounce', async () => {
      vi.useFakeTimers();
      mockedAxios.get.mockImplementation((url: string) => {
        if (url === '/programs/filters') return Promise.resolve({ data: {} });
        return Promise.resolve({ data: { results: [], total: 0 } });
      });

      render(
        <MemoryRouter initialEntries={['/programs']}>
          <UserContext.Provider
            value={{
              isLoading: false,
              isAuthenticated: true,
              user: { userType: 'student', isAdmin: false } as any,
              checkContext: vi.fn(),
            }}
          >
            <FellowshipSearchContextProvider>
              <FellowshipSearchContext.Consumer>
                {(context) => (
                  <>
                    <button type="button" onClick={() => context.setQueryString('marine')}>
                      Type query
                    </button>
                    <button type="button" onClick={() => context.setQueryString('')}>
                      Clear query
                    </button>
                  </>
                )}
              </FellowshipSearchContext.Consumer>
            </FellowshipSearchContextProvider>
          </UserContext.Provider>
        </MemoryRouter>,
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      const searchUrls = () =>
        mockedAxios.get.mock.calls
          .map(([url]) => String(url))
          .filter((url) => url.startsWith('/programs/search'));
      expect(searchUrls()).toHaveLength(1);

      act(() => {
        screen.getByRole('button', { name: 'Type query' }).click();
      });
      act(() => {
        screen.getByRole('button', { name: 'Clear query' }).click();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      expect(searchUrls()).toHaveLength(1);

      act(() => {
        screen.getByRole('button', { name: 'Type query' }).click();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      expect(searchUrls()).toHaveLength(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });
      expect(searchUrls()).toHaveLength(2);
      expect(searchUrls()[1]).toContain('query=marine');
    });
  });
});
