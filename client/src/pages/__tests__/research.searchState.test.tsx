import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Research, { __resetResearchPageSnapshotForTests } from '../research';
import axios from '../../utils/axios';
import ConfigContext, { defaultConfigContext } from '../../contexts/ConfigContext';
import UserContext, { defaultUserContext } from '../../contexts/UserContext';
import { resetResearchAnalyticsDedupeForTests } from '../../utils/researchAnalytics';

vi.mock('../../utils/axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

const mockedAxios = axios as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

interface SearchBody {
  q?: string;
  filters?: Record<string, unknown>;
  page?: number;
  sortBy?: string;
  sortOrder?: string;
}

type SearchResolver = (body: SearchBody) => unknown;

const departments = [
  {
    abbreviation: 'CPSC',
    name: 'Computer Science',
    displayName: 'Computer Science',
    categories: ['Computing & AI'],
    primaryCategory: 'Computing & AI',
    colorKey: 0,
  },
];

const entity = (id: string, name: string) => ({
  _id: id,
  slug: id,
  name,
  displayName: name,
  kind: 'lab',
  fullDescription: `${name} studies reliable systems.`,
  websiteUrl: '',
  location: '',
  departments: ['Computer Science'],
  researchAreas: ['Systems'],
  school: 'Yale College',
  typicalUndergradRoles: [],
  prerequisiteCourses: [],
  creditOptions: [],
  fundingPrograms: [],
  contactEmail: '',
  contactName: '',
  contactRole: '',
  sourceUrls: ['https://example.yale.edu/lab'],
});

const unfilteredLab = entity('unfiltered-lab', 'Unfiltered Lab');
const filteredLab = entity('filtered-lab', 'Filtered Lab');
const browseLab = entity('browse-lab', 'Browse Lab');
const secondBrowseLab = entity('second-browse-lab', 'Second Browse Lab');

const searchResponse = (researchEntities: unknown[], overrides: Record<string, unknown> = {}) => ({
  data: {
    researchEntities,
    estimatedTotalHits: researchEntities.length,
    page: 1,
    pageSize: 24,
    facetDistribution: {
      school: { 'Yale College': 3, 'School of Medicine': 2 },
      departments: { 'Computer Science': 3 },
    },
    ...overrides,
  },
});

const pendingForever = () => new Promise<never>(() => undefined);

const useSearchResolver = (resolver: SearchResolver) => {
  mockedAxios.post.mockImplementation((url: string, body: SearchBody) => {
    if (url === '/analytics/research' || url === '/analytics/research/batch') {
      return Promise.resolve({ data: { ok: true, accepted: 1 }, status: 202 });
    }
    if (url !== '/research/search') return Promise.reject(new Error(`Unexpected ${url}`));
    return Promise.resolve(resolver(body));
  });
};

const searchBodies = (): SearchBody[] =>
  mockedAxios.post.mock.calls
    .filter(([url]) => url === '/research/search')
    .map(([, body]) => body as SearchBody);

const LocationDisplay = () => {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
};

const LeaveToProfile = () => {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => void navigate('/research/some-profile')}>
      Leave to a profile
    </button>
  );
};

const renderResearchPage = (initialEntry = '/research') =>
  render(
    <StrictMode>
      <MemoryRouter initialEntries={[initialEntry]}>
        <UserContext.Provider
          value={{
            ...defaultUserContext,
            isLoading: false,
            isAuthenticated: false,
            user: undefined,
          }}
        >
          <ConfigContext.Provider
            value={{
              ...defaultConfigContext,
              isLoading: false,
              isLoaded: true,
              departments,
              departmentCategories: ['Computing & AI'],
            }}
          >
            <LocationDisplay />
            <Routes>
              <Route
                path="/research"
                element={
                  <>
                    <LeaveToProfile />
                    <Research />
                  </>
                }
              />
              <Route path="/research/:slug" element={<BackToResearch />} />
            </Routes>
          </ConfigContext.Provider>
        </UserContext.Provider>
      </MemoryRouter>
    </StrictMode>,
  );

const BackToResearch = () => {
  const navigate = useNavigate();
  return (
    <div>
      <h1>Research profile</h1>
      <button type="button" onClick={() => void navigate(-1)}>
        Back to research
      </button>
    </div>
  );
};

const submitSearch = (value: string) => {
  fireEvent.change(screen.getByLabelText('Search y/labs'), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
};

const chooseSort = (optionName: string) => {
  fireEvent.click(screen.getByRole('button', { name: /Sort research/ }));
  fireEvent.click(screen.getByRole('option', { name: optionName }));
};

const chooseSchool = (school: string) => {
  fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
  fireEvent.change(screen.getByLabelText('Filter by school'), { target: { value: school } });
};

const leaveAndComeBack = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Leave to a profile' }));
  await screen.findByRole('heading', { name: 'Research profile' });
  fireEvent.click(screen.getByRole('button', { name: 'Back to research' }));
  await screen.findByLabelText('Search y/labs');
};

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  mockedAxios.get.mockResolvedValue({ data: {} });
});

let intersectionCallback: IntersectionObserverCallback | undefined;
const originalIntersectionObserver = window.IntersectionObserver;
const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;

const observeSentinelsManually = () => {
  class ManualIntersectionObserver {
    constructor(callback: IntersectionObserverCallback) {
      intersectionCallback = callback;
    }

    observe = vi.fn();
    disconnect = vi.fn();
    unobserve = vi.fn();
    takeRecords = vi.fn(() => []);
  }
  window.IntersectionObserver =
    ManualIntersectionObserver as unknown as typeof IntersectionObserver;
  globalThis.IntersectionObserver =
    ManualIntersectionObserver as unknown as typeof IntersectionObserver;
  Element.prototype.getBoundingClientRect = vi.fn(() => ({
    bottom: 2000,
    height: 1,
    left: 0,
    right: 1,
    top: 2000,
    width: 1,
    x: 0,
    y: 2000,
    toJSON: () => ({}),
  }));
};

const reachSentinel = async () => {
  await waitFor(() => expect(intersectionCallback).toBeDefined());
  await act(async () => {
    intersectionCallback?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });
};

afterEach(() => {
  intersectionCallback = undefined;
  window.IntersectionObserver = originalIntersectionObserver;
  globalThis.IntersectionObserver = originalIntersectionObserver;
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  cleanup();
  __resetResearchPageSnapshotForTests();
  resetResearchAnalyticsDedupeForTests();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('Research page search state', () => {
  it('re-runs a filter change that was still loading when the student left and came back', async () => {
    let holdFilteredSearch = true;
    useSearchResolver((body) => {
      if (!body.q) return searchResponse([browseLab]);
      if (body.filters?.school) {
        return holdFilteredSearch ? pendingForever() : searchResponse([filteredLab]);
      }
      return searchResponse([unfilteredLab]);
    });

    renderResearchPage();
    await screen.findByRole('heading', { name: 'Browse Lab' });
    submitSearch('robotics');
    await screen.findByRole('heading', { name: 'Unfiltered Lab' });

    chooseSchool('Yale College');
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/research?q=robotics&school=Yale+College',
      ),
    );

    holdFilteredSearch = false;
    await leaveAndComeBack();

    expect(await screen.findByRole('heading', { name: 'Filtered Lab' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Unfiltered Lab' })).toBeNull();
  });

  it('re-runs a fresh search that was still loading when the student left and came back', async () => {
    let holdSearch = true;
    useSearchResolver((body) => {
      if (!body.q) return searchResponse([browseLab]);
      return holdSearch ? pendingForever() : searchResponse([filteredLab]);
    });

    renderResearchPage();
    await screen.findByRole('heading', { name: 'Browse Lab' });
    submitSearch('robotics');
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/research?q=robotics'),
    );

    holdSearch = false;
    await leaveAndComeBack();

    expect(await screen.findByRole('heading', { name: 'Filtered Lab' })).toBeTruthy();
    expect(screen.queryByText(/No indexed research matched/)).toBeNull();
  });

  it('keeps the chosen sort when a search that was still loading is re-run after coming back', async () => {
    let holdSortedSearch = true;
    useSearchResolver((body) => {
      if (!body.q) return searchResponse([browseLab]);
      if (body.sortBy === 'name') {
        return holdSortedSearch ? pendingForever() : searchResponse([filteredLab]);
      }
      return searchResponse([unfilteredLab]);
    });

    renderResearchPage();
    await screen.findByRole('heading', { name: 'Browse Lab' });
    submitSearch('robotics');
    await screen.findByRole('heading', { name: 'Unfiltered Lab' });
    chooseSort('Name');
    await waitFor(() => expect(searchBodies().at(-1)?.sortBy).toBe('name'));

    holdSortedSearch = false;
    await leaveAndComeBack();

    expect(await screen.findByRole('heading', { name: 'Filtered Lab' })).toBeTruthy();
    expect(searchBodies().at(-1)).toEqual(
      expect.objectContaining({ q: 'robotics', sortBy: 'name', sortOrder: 'asc' }),
    );
  });

  it('re-sorts the submitted query, not an unsubmitted draft, when the sort changes', async () => {
    useSearchResolver((body) => {
      if (!body.q) return searchResponse([browseLab]);
      return searchResponse([body.sortBy === 'name' ? filteredLab : unfilteredLab]);
    });

    renderResearchPage();
    await screen.findByRole('heading', { name: 'Browse Lab' });
    submitSearch('robotics');
    await screen.findByRole('heading', { name: 'Unfiltered Lab' });

    fireEvent.change(screen.getByLabelText('Search y/labs'), { target: { value: 'neuroscience' } });
    chooseSort('Name');

    expect(await screen.findByRole('heading', { name: 'Filtered Lab' })).toBeTruthy();
    expect(searchBodies().at(-1)).toEqual(
      expect.objectContaining({ q: 'robotics', sortBy: 'name' }),
    );
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/for 'robotics'/));
    expect(screen.getByLabelText('Search y/labs')).toHaveValue('neuroscience');
    expect(screen.getByTestId('location').textContent).toBe('/research?q=robotics');

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() =>
      expect(searchBodies().at(-1)).toEqual(
        expect.objectContaining({ q: 'neuroscience', sortBy: 'name' }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toMatch(/for 'neuroscience'/),
    );
  });

  it('reloads browse in the new order after a sort change during a search is cleared', async () => {
    useSearchResolver((body) => {
      if (!body.q) {
        return searchResponse(
          body.sortBy === 'name' ? [secondBrowseLab, browseLab] : [browseLab, secondBrowseLab],
          { estimatedTotalHits: 2 },
        );
      }
      return searchResponse([unfilteredLab]);
    });

    renderResearchPage();
    await screen.findByRole('heading', { name: 'Browse Lab' });
    submitSearch('robotics');
    await screen.findByRole('heading', { name: 'Unfiltered Lab' });
    chooseSort('Name');
    await waitFor(() => expect(searchBodies().at(-1)?.sortBy).toBe('name'));

    fireEvent.change(screen.getByLabelText('Search y/labs'), { target: { value: '' } });

    await screen.findByText('Research to explore');
    await waitFor(() => {
      const headings = screen
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent);
      expect(headings.slice(0, 2)).toEqual(['Second Browse Lab', 'Browse Lab']);
    });
    expect(searchBodies().at(-1)).toEqual(
      expect.objectContaining({ q: '', page: 1, sortBy: 'name' }),
    );
  });

  it('reloads browse in the new order after a restored search is cleared', async () => {
    useSearchResolver((body) => {
      if (!body.q) {
        return searchResponse(
          body.sortBy === 'name' ? [secondBrowseLab, browseLab] : [browseLab, secondBrowseLab],
          { estimatedTotalHits: 2 },
        );
      }
      return searchResponse([unfilteredLab]);
    });

    renderResearchPage();
    await screen.findByRole('heading', { name: 'Browse Lab' });
    await leaveAndComeBack();
    await screen.findByRole('heading', { name: 'Browse Lab' });
    submitSearch('robotics');
    await screen.findByRole('heading', { name: 'Unfiltered Lab' });
    chooseSort('Name');
    await waitFor(() => expect(searchBodies().at(-1)?.sortBy).toBe('name'));

    fireEvent.change(screen.getByLabelText('Search y/labs'), { target: { value: '' } });

    await screen.findByText('Research to explore');
    await waitFor(() => {
      const headings = screen
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent);
      expect(headings.slice(0, 2)).toEqual(['Second Browse Lab', 'Browse Lab']);
    });
  });

  it('keeps active filters when the search box is emptied', async () => {
    useSearchResolver((body) => {
      if (!body.q && !body.filters?.school) return searchResponse([browseLab]);
      if (!body.q) return searchResponse([filteredLab]);
      return searchResponse([unfilteredLab]);
    });

    renderResearchPage('/research?q=robotics&school=Yale+College');
    await screen.findByRole('heading', { name: 'Unfiltered Lab' });

    fireEvent.change(screen.getByLabelText('Search y/labs'), { target: { value: '' } });

    expect(await screen.findByRole('heading', { name: 'Filtered Lab' })).toBeTruthy();
    expect(screen.getByTestId('location').textContent).toBe('/research?school=Yale+College');
    expect(searchBodies().at(-1)).toEqual(
      expect.objectContaining({ q: '', filters: { school: ['Yale College'] } }),
    );
    expect(screen.getByRole('status').textContent).toMatch(/match your filters/);
  });

  it('keeps a department search when a student filter is added to it', async () => {
    useSearchResolver((body) => {
      if (body.q) return searchResponse([unfilteredLab]);
      return searchResponse([body.filters?.school ? filteredLab : browseLab]);
    });

    renderResearchPage('/research?dept=Computer+Science');
    await screen.findByRole('heading', { name: 'Browse Lab' });
    expect(searchBodies().at(-1)).toEqual(
      expect.objectContaining({ q: '', filters: { departments: ['Computer Science'] } }),
    );

    chooseSchool('Yale College');

    expect(await screen.findByRole('heading', { name: 'Filtered Lab' })).toBeTruthy();
    expect(searchBodies().at(-1)).toEqual(
      expect.objectContaining({
        q: '',
        filters: { school: ['Yale College'], departments: ['Computer Science'] },
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/research?q=Computer+Science&dept=Computer+Science&school=Yale+College',
      ),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(searchBodies().filter((body) => body.q)).toEqual([]);
  });

  it('fetches the next search page again when it was still loading as the student left', async () => {
    observeSentinelsManually();
    let holdSecondPage = true;
    useSearchResolver((body) => {
      if (!body.q) return searchResponse([browseLab]);
      if (body.page === 2) {
        return holdSecondPage
          ? pendingForever()
          : searchResponse([filteredLab], { page: 2, estimatedTotalHits: 25 });
      }
      return searchResponse([unfilteredLab], { estimatedTotalHits: 25 });
    });

    renderResearchPage();
    await screen.findByRole('heading', { name: 'Browse Lab' });
    submitSearch('robotics');
    await screen.findByRole('heading', { name: 'Unfiltered Lab' });
    await reachSentinel();
    await waitFor(() => expect(searchBodies().at(-1)?.page).toBe(2));

    holdSecondPage = false;
    intersectionCallback = undefined;
    await leaveAndComeBack();
    await screen.findByRole('heading', { name: 'Unfiltered Lab' });
    await reachSentinel();

    expect(await screen.findByRole('heading', { name: 'Filtered Lab' })).toBeTruthy();
    expect(
      searchBodies()
        .filter((body) => body.q === 'robotics')
        .map((body) => body.page),
    ).toEqual([1, 2, 2]);
  });
});
