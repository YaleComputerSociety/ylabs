import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Research, { __resetResearchPageSnapshotForTests } from '../research';
import axios from '../../utils/axios';
import ConfigContext, { defaultConfigContext } from '../../contexts/ConfigContext';
import UserContext, { defaultUserContext } from '../../contexts/UserContext';
import type { User } from '../../types/types';

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

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
};

let intersectionCallback: IntersectionObserverCallback | undefined;
const originalIntersectionObserver = window.IntersectionObserver;
const originalGlobalIntersectionObserver = globalThis.IntersectionObserver;
const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;

const researchSearchResponse = (researchEntities: unknown[] = [], overrides: Record<string, unknown> = {}) => ({
  data: {
    researchEntities,
    estimatedTotalHits: researchEntities.length,
    page: 1,
    pageSize: 24,
    ...overrides,
  },
});

const unexpectedSearchEndpoint = (url: string): never => {
  throw new Error(`Unexpected retired or unknown search endpoint: ${url}`);
};

const mockSearchResponses = (
  resolver: (
    url: string,
    body: {
      q?: string;
      filters?: Record<string, unknown>;
      page?: number;
      browseQuality?: string;
    },
  ) => unknown,
) => {
  mockedAxios.post.mockImplementation(
    (
      url: string,
      body: {
        q?: string;
        filters?: Record<string, unknown>;
        page?: number;
        browseQuality?: string;
      },
    ) =>
      Promise.resolve(resolver(url, body)),
  );
};

const mockEmptySearchResponses = () => {
  mockSearchResponses((url) =>
    url === '/research/search' ? researchSearchResponse() : unexpectedSearchEndpoint(url),
  );
};

const departments = [
  {
    abbreviation: 'AMTH',
    name: 'Applied Mathematics',
    displayName: 'AMTH - Applied Mathematics',
    categories: ['Mathematics'],
    primaryCategory: 'Mathematics',
    colorKey: 8,
  },
  {
    abbreviation: 'CPSC',
    name: 'Computer Science',
    displayName: 'Computer Science',
    categories: ['Computing & AI'],
    primaryCategory: 'Computing & AI',
    colorKey: 0,
  },
  {
    abbreviation: 'HSAR',
    name: 'History of Art',
    displayName: 'History of Art',
    categories: ['Humanities & Arts'],
    primaryCategory: 'Humanities & Arts',
    colorKey: 5,
  },
  {
    abbreviation: 'MB&B',
    name: 'Molecular Biophysics and Biochemistry',
    displayName: 'Molecular Biophysics and Biochemistry',
    categories: ['Life Sciences'],
    primaryCategory: 'Life Sciences',
    colorKey: 1,
  },
];

const renderResearch = (
  departmentList = departments,
  initialEntries: string[] = ['/research'],
  user?: Partial<User>,
) =>
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <UserContext.Provider
        value={{
          ...defaultUserContext,
          isLoading: false,
          isAuthenticated: Boolean(user),
          user: user as User | undefined,
        }}
      >
        <ConfigContext.Provider
          value={{
            ...defaultConfigContext,
            isLoading: false,
            isLoaded: true,
            departments: departmentList,
            departmentCategories: ['Computing & AI', 'Humanities & Arts', 'Life Sciences'],
          }}
        >
          <Research />
        </ConfigContext.Provider>
      </UserContext.Provider>
    </MemoryRouter>,
  );

const renderResearchStrict = (
  departmentList = departments,
  initialEntries: string[] = ['/research'],
) =>
  render(
    <StrictMode>
      <MemoryRouter initialEntries={initialEntries}>
        <ConfigContext.Provider
          value={{
            ...defaultConfigContext,
            isLoading: false,
            isLoaded: true,
            departments: departmentList,
            departmentCategories: ['Computing & AI', 'Humanities & Arts', 'Life Sciences'],
          }}
        >
          <Research />
        </ConfigContext.Provider>
      </MemoryRouter>
    </StrictMode>,
  );

const BackButton = () => {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(-1)}>
      Back to research
    </button>
  );
};

const renderResearchWithDetailRoute = () =>
  render(
    <StrictMode>
      <MemoryRouter initialEntries={['/research']}>
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
              departmentCategories: ['Computing & AI', 'Humanities & Arts', 'Life Sciences'],
            }}
          >
            <Routes>
              <Route path="/research" element={<Research />} />
              <Route
                path="/research/:slug"
                element={
                  <div>
                    <h1>Research profile</h1>
                    <BackButton />
                  </div>
                }
              />
            </Routes>
          </ConfigContext.Provider>
        </UserContext.Provider>
      </MemoryRouter>
    </StrictMode>,
  );

const researchEntity = {
  _id: 'entity-1',
  slug: 'ai-safety-lab',
  name: 'AI Safety Lab',
  displayName: 'AI Safety Lab',
  kind: 'lab',
  description: 'Studies reliable machine learning systems.',
  websiteUrl: '',
  location: '',
  departments: ['Computer Science'],
  researchAreas: ['AI safety'],
  school: 'Yale College',
  openness: 'unknown',
  typicalUndergradRoles: [],
  prerequisiteCourses: [],
  creditOptions: [],
  fundingPrograms: [],
  contactEmail: '',
  contactName: 'Ada Researcher',
  contactRole: 'Principal investigator',
  sourceUrls: ['https://example.yale.edu/ai-safety'],
};

const pathwayHit = {
  _id: 'pathway-1',
  pathwayType: 'EXPLORATORY_CONTACT',
  status: 'ACTIVE',
  evidenceStrength: 'SOURCE_BACKED',
  studentFacingLabel: 'Plan careful outreach',
  explanation: 'Review the lab profile before contacting anyone.',
  bestNextStep: 'Read the source profile first.',
  bestNextStepCategory: 'plan-outreach',
  confidence: 0.72,
  sourceUrls: ['https://example.edu/ai-safety'],
  researchEntity: {
    _id: 'entity-1',
    slug: 'ai-safety-lab',
    name: 'AI Safety Lab',
    displayName: 'AI Safety Lab',
    description: 'Studies reliable machine learning systems.',
  },
  evidence: [
    {
      signalType: 'official profile',
      sourceUrl: 'https://example.edu/ai-safety',
      excerpt: 'Reliable machine learning systems.',
      confidenceScore: 0.72,
    },
  ],
};

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  mockedAxios.get.mockResolvedValue({
    data: {
      suggestions: [
        { label: 'machine learning', query: 'machine learning' },
        { label: 'public health', query: 'public health' },
        { label: 'archival research', query: 'archival research' },
        { label: 'climate policy', query: 'climate policy' },
        { label: 'social science data', query: 'social science data' },
        { label: 'wet lab', query: 'wet lab' },
      ],
    },
  });
  mockEmptySearchResponses();
});

afterEach(() => {
  cleanup();
  __resetResearchPageSnapshotForTests();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  intersectionCallback = undefined;
  window.IntersectionObserver = originalIntersectionObserver;
  globalThis.IntersectionObserver = originalGlobalIntersectionObserver;
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
});

describe('Research page', () => {
  it('renders the search-first shell with recognition-first quick starts', async () => {
    mockSearchResponses((url) =>
      url === '/research/search'
        ? researchSearchResponse([researchEntity])
        : unexpectedSearchEndpoint(url),
    );

    const { container } = renderResearch();

    expect(container.textContent).toContain('Search Yale research');
    expect(container.textContent).toContain('Find a Yale lab that fits you.');
    expect(container.textContent).toContain(
      'Search by interest, professor, course topic, method, or question.',
    );
    expect(container.textContent).not.toContain('How to use this');
    expect(container.textContent).not.toContain('Trust constraint');
    expect(container.textContent).not.toContain('Topic-first discovery');
    expect(container.textContent).not.toContain(
      'Map an idea to Yale research homes, people, and practical next steps.',
    );
    expect(container.textContent).not.toContain('Yale papers');
    expect(
      screen.getByPlaceholderText('Type a topic, professor, lab, method, or research question'),
    ).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Search' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(container.textContent).toContain('Enter a topic or name to enable Search.');
    expect(container.textContent).toContain('Try a starting point');
    expect(screen.queryByRole('button', { name: 'Explore research homes' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Machine learning' }).className).toContain(
      'min-h-[44px]',
    );
    expect(screen.getByRole('button', { name: 'Public health' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Wet lab' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Archival research' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Explore by department' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Look up a professor' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open roles' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Paid or funded research' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Beginner-friendly labs' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Thesis lab search' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Summer research' })).toBeNull();
    expect(await screen.findByRole('heading', { name: 'AI Safety Lab' })).toBeTruthy();
    expect(container.textContent).not.toContain('Top profile preview');
    expect(container.textContent).toContain('Research homes to explore');
    expect(container.textContent).not.toContain('Official Yale source found');
    expect(container.textContent).not.toContain('Source-backed profile context');
    const browseSection = screen.getByLabelText('Research homes to explore');
    const browseHeadingRow = within(browseSection).getByText('Research homes to explore').parentElement;
    expect(browseHeadingRow?.parentElement?.className).toContain('w-full');
    expect(browseHeadingRow?.className).toContain('justify-between');
    expect(within(browseSection).queryByText('1 profile')).toBeNull();
    const browseLayout = Array.from(browseSection.querySelectorAll('.grid')).find(
      (element) =>
        element.className.includes('grid gap-5') &&
        !element.className.includes('xl:grid-cols'),
    );
    const browseGrid = browseSection.querySelector('.grid.gap-3');
    expect(browseLayout?.className).toContain('grid gap-5');
    expect(browseGrid?.className).toContain('grid gap-3');
    expect(browseGrid?.className).toContain('lg:grid-cols-2');
    expect(browseGrid?.className).toContain('2xl:grid-cols-[repeat(3,minmax(0,1fr))]');
    expect(browseGrid?.className).not.toContain('items-start');
    expect(browseGrid?.className).not.toContain('md:grid-cols-2');
    expect(browseGrid?.className).not.toContain('xl:grid-cols-3');
    expect(mockedAxios.post).toHaveBeenCalledWith(
      '/research/search',
      expect.objectContaining({
        q: '',
        pageSize: 24,
        filters: {},
      }),
      expect.any(Object),
    );
    expect(screen.queryByRole('button', { name: 'Refine search' })).toBeNull();
    expect(screen.queryByLabelText('Department')).toBeNull();
    expect(screen.queryByLabelText('Method/topic')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open roles' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Machine learning' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Archival research' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Digital humanities' })).toBeTruthy();
    expect(container.textContent).not.toContain('mechanism design');
    expect(container.textContent).not.toContain('neuroscience');
    expect(container.textContent).not.toContain('protein folding');
    expect(container.textContent).not.toContain('BCIs for ALS');
    expect(container.textContent).not.toContain('Browse Yale departments');
    expect(container.textContent).not.toContain(
      'Use this when you already know the Yale unit. Some departments may still show coverage gaps while data is being seeded.',
    );
    expect(screen.queryByRole('button', { name: 'AMTH - Applied Mathematics' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'AMTH - Applied Mathematics' })).toBeNull();
    expect(container.textContent).not.toContain('Explore topic clusters');
    expect(container.textContent).not.toContain('Search results');
    expect(container.textContent).not.toContain('Query: all Yale research');
    expect(screen.getAllByRole('link', { name: 'View profile →' })).toHaveLength(1);
    expect(container.textContent).not.toContain('Research Cluster Rows');
    expect(container.textContent).not.toContain('Grouped Search Results');
    expect(container.textContent).not.toContain('V1 fallback');
    expect(container.textContent).not.toContain('0 profiles');
    expect((screen.getByRole('button', { name: 'Search' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('submits quick-start prompts as research searches', async () => {
    mockSearchResponses((url, body) => {
      if (url !== '/research/search') return unexpectedSearchEndpoint(url);
      return researchSearchResponse(
        body.q === 'wet lab'
          ? [
              {
                ...researchEntity,
                _id: 'wet-lab-1',
                slug: 'wet-lab-example',
                name: 'Wet Lab Example',
                displayName: 'Wet Lab Example',
                researchAreas: ['Wet lab'],
              },
            ]
          : [],
      );
    });

    renderResearch();

    await screen.findByText('Try a starting point');
    fireEvent.click(screen.getByRole('button', { name: 'Wet lab' }));

    await screen.findByRole('heading', { name: 'Wet Lab Example' });
    expect(mockedAxios.post).toHaveBeenLastCalledWith(
      '/research/search',
      expect.objectContaining({
        q: 'wet lab',
        filters: {},
      }),
      expect.any(Object),
    );
  });

  it('uses research search enrichment without calling the retired Pathways API', async () => {
    mockSearchResponses((url) =>
      url === '/research/search'
        ? researchSearchResponse([
            {
              ...researchEntity,
              waysIn: [pathwayHit],
            },
          ])
        : unexpectedSearchEndpoint(url),
    );

    const { container } = renderResearch();

    await screen.findByRole('heading', { name: 'AI Safety Lab' });

    expect(
      mockedAxios.post.mock.calls.some(([url]) => url === '/pathways/search'),
    ).toBe(false);
    expect(container.textContent).toContain('Best next step: Plan targeted outreach');
  });

  it('lets admins put weakest profiles first only for the default browse', async () => {
    mockSearchResponses((url, body) => {
      if (url !== '/research/search') return unexpectedSearchEndpoint(url);
      return researchSearchResponse([
        {
          ...researchEntity,
          name: body.browseQuality === 'low-first' ? 'Sparse Lab' : 'AI Safety Lab',
          displayName: body.browseQuality === 'low-first' ? 'Sparse Lab' : 'AI Safety Lab',
          slug: body.browseQuality === 'low-first' ? 'sparse-lab' : 'ai-safety-lab',
        },
      ]);
    });

    renderResearch(departments, ['/research'], {
      netId: 'admin1',
      userType: 'admin',
      userConfirmed: true,
    });

    await screen.findByRole('heading', { name: 'AI Safety Lab' });
    const toggle = screen.getByLabelText('Show weakest profiles first') as HTMLInputElement;
    expect(toggle.checked).toBe(false);

    fireEvent.click(toggle);

    await screen.findByRole('heading', { name: 'Sparse Lab' });
    expect(mockedAxios.post).toHaveBeenLastCalledWith(
      '/research/search',
      expect.objectContaining({
        q: '',
        filters: {},
        browseQuality: 'low-first',
      }),
      expect.any(Object),
    );

    fireEvent.change(screen.getByLabelText('Search Yale research'), {
      target: { value: 'machine learning' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      expect(mockedAxios.post).toHaveBeenLastCalledWith(
        '/research/search',
        expect.objectContaining({
          q: 'machine learning',
          filters: {},
        }),
        expect.any(Object),
      );
    });
    expect(mockedAxios.post.mock.calls.at(-1)?.[1]).not.toHaveProperty('browseQuality');
  });

  it('does not show the weakest-first browse toggle to non-admin users', async () => {
    mockSearchResponses((url) =>
      url === '/research/search'
        ? researchSearchResponse([researchEntity])
        : unexpectedSearchEndpoint(url),
    );

    renderResearch(departments, ['/research'], {
      netId: 'student1',
      userType: 'student',
      userConfirmed: true,
    });

    await screen.findByRole('heading', { name: 'AI Safety Lab' });
    expect(screen.queryByLabelText('Show weakest profiles first')).toBeNull();
  });

  it('loads and appends more research homes when the browse sentinel is reached', async () => {
    class MockIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
      }

      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
      takeRecords = vi.fn(() => []);
    }

    window.IntersectionObserver =
      MockIntersectionObserver as unknown as typeof IntersectionObserver;
    globalThis.IntersectionObserver =
      MockIntersectionObserver as unknown as typeof IntersectionObserver;
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

    const nextResearchEntity = {
      ...researchEntity,
      _id: 'entity-2',
      slug: 'wright-lab',
      name: 'Wright Lab',
      displayName: 'Wright Lab',
    };

    mockSearchResponses((url, body) => {
      if (url !== '/research/search') return unexpectedSearchEndpoint(url);
      return researchSearchResponse(
        body.page === 2 ? [nextResearchEntity] : [researchEntity],
        { estimatedTotalHits: 25, page: body.page || 1 },
      );
    });

    renderResearch();

    await screen.findByRole('heading', { name: 'AI Safety Lab' });
    await waitFor(() => {
      expect(intersectionCallback).toBeDefined();
    });

    await act(async () => {
      intersectionCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    await screen.findByRole('heading', { name: 'Wright Lab' });
    expect(screen.getByRole('heading', { name: 'AI Safety Lab' })).toBeTruthy();
    expect(mockedAxios.post).toHaveBeenCalledWith(
      '/research/search',
      expect.objectContaining({ page: 2, pageSize: 24 }),
      expect.any(Object),
    );
  });

  it('shows a three-dot loading status while more browse research homes load', async () => {
    class MockIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
      }

      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
      takeRecords = vi.fn(() => []);
    }

    window.IntersectionObserver =
      MockIntersectionObserver as unknown as typeof IntersectionObserver;
    globalThis.IntersectionObserver =
      MockIntersectionObserver as unknown as typeof IntersectionObserver;
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

    const nextPage = createDeferred<{
      data: {
        researchEntities: unknown[];
        estimatedTotalHits: number;
        page: number;
        pageSize: number;
      };
    }>();

    mockedAxios.post.mockImplementation(
      (url: string, body: { page?: number }) => {
        if (url !== '/research/search') {
          return Promise.reject(new Error(`Unexpected retired or unknown search endpoint: ${url}`));
        }
        if (body.page === 2) return nextPage.promise;
        return Promise.resolve(
          researchSearchResponse([researchEntity], { estimatedTotalHits: 25, page: 1 }),
        );
      },
    );

    renderResearch();

    await screen.findByRole('heading', { name: 'AI Safety Lab' });
    await waitFor(() => {
      expect(intersectionCallback).toBeDefined();
    });

    await act(async () => {
      intersectionCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    await waitFor(() => {
      expect(mockedAxios.post).toHaveBeenCalledWith(
        '/research/search',
        expect.objectContaining({ page: 2, pageSize: 24 }),
        expect.any(Object),
      );
    });

    expect(screen.getByRole('status').textContent).toContain('Loading more research homes');

    nextPage.resolve(
      researchSearchResponse([], {
        estimatedTotalHits: 25,
        page: 2,
      }),
    );
  });

  it('keeps browse infinite scroll active when the first research page is full', async () => {
    class MockIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
      }

      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
      takeRecords = vi.fn(() => []);
    }

    window.IntersectionObserver =
      MockIntersectionObserver as unknown as typeof IntersectionObserver;
    globalThis.IntersectionObserver =
      MockIntersectionObserver as unknown as typeof IntersectionObserver;
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

    const firstPage = Array.from({ length: 24 }, (_, index) => ({
      ...researchEntity,
      _id: `entity-${index + 1}`,
      slug: `research-home-${index + 1}`,
      name: `Research Home ${index + 1}`,
      displayName: `Research Home ${index + 1}`,
    }));
    const nextResearchEntity = {
      ...researchEntity,
      _id: 'entity-25',
      slug: 'research-home-25',
      name: 'Research Home 25',
      displayName: 'Research Home 25',
    };

    mockSearchResponses((url, body) => {
      if (url !== '/research/search') return unexpectedSearchEndpoint(url);
      return researchSearchResponse(
        body.page === 2 ? [nextResearchEntity] : firstPage,
        { estimatedTotalHits: 24, page: body.page || 1 },
      );
    });

    renderResearch();

    await screen.findByRole('heading', { name: 'Research Home 1' });
    await waitFor(() => {
      expect(intersectionCallback).toBeDefined();
    });

    await act(async () => {
      intersectionCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    await screen.findByRole('heading', { name: 'Research Home 25' });
    expect(mockedAxios.post).toHaveBeenCalledWith(
      '/research/search',
      expect.objectContaining({ page: 2, pageSize: 24 }),
      expect.any(Object),
    );
  });

  it('loads and appends more research homes for submitted searches when the sentinel is reached', async () => {
    class MockIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
      }

      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
      takeRecords = vi.fn(() => []);
    }

    window.IntersectionObserver =
      MockIntersectionObserver as unknown as typeof IntersectionObserver;
    globalThis.IntersectionObserver =
      MockIntersectionObserver as unknown as typeof IntersectionObserver;
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

    const nextResearchEntity = {
      ...researchEntity,
      _id: 'entity-2',
      slug: 'wright-lab',
      name: 'Wright Lab',
      displayName: 'Wright Lab',
    };

    mockSearchResponses((url, body) => {
      if (url !== '/research/search') return unexpectedSearchEndpoint(url);
      return researchSearchResponse(
        body.page === 2 ? [nextResearchEntity] : [researchEntity],
        { estimatedTotalHits: 25, page: body.page || 1 },
      );
    });

    renderResearch(departments, ['/research?q=protein+folding']);

    await screen.findByText("Showing research matches for 'protein folding'");
    await screen.findByRole('heading', { name: 'AI Safety Lab' });
    await waitFor(() => {
      expect(intersectionCallback).toBeDefined();
    });

    await act(async () => {
      intersectionCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    await screen.findByRole('heading', { name: 'Wright Lab' });
    expect(screen.getByRole('heading', { name: 'AI Safety Lab' })).toBeTruthy();
    expect(mockedAxios.post).toHaveBeenCalledWith(
      '/research/search',
      expect.objectContaining({ q: 'protein folding', page: 2, pageSize: 24 }),
      expect.any(Object),
    );
  });

  it('does not expose server-provided or hardcoded example search chips', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        suggestions: [
          { label: 'robotics ethics', query: 'robotics ethics' },
          { label: 'urban history', query: 'urban history' },
          { label: 'view lab website', query: 'view lab website' },
          { label: 'view related publication', query: 'view related publication' },
          { label: '2 ysm researchers', query: '2 ysm researchers' },
          { label: 'publications', query: 'publications' },
          {
            label: 'neuroscience and neuropharmacology research',
            query: 'neuroscience and neuropharmacology research',
          },
          { label: 'machine learning', query: 'machine learning' },
          { label: 'public health', query: 'public health' },
        ],
      },
    });

    renderResearch();

    expect(screen.queryByText('Popular starting points')).toBeNull();
    expect(screen.queryByRole('button', { name: 'robotics ethics' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'urban history' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'view lab website' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'view related publication' })).toBeNull();
    expect(screen.queryByRole('button', { name: '2 ysm researchers' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'publications' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'machine learning' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'public health' })).toBeNull();

    mockSearchResponses((url, body) =>
      url === '/research/search' && body.q === 'robotics ethics'
        ? researchSearchResponse([{ ...researchEntity, name: 'AI Safety Lab' }])
        : unexpectedSearchEndpoint(url),
    );

    fireEvent.change(screen.getByLabelText('Search Yale research'), {
      target: { value: 'robotics ethics' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByRole('heading', { name: 'AI Safety Lab' })).toBeTruthy();
  });

  it('runs the research search from q handoff links on initial render', async () => {
    mockSearchResponses((url) =>
      url === '/research/search'
        ? researchSearchResponse([{ ...researchEntity, waysIn: [pathwayHit] }])
        : unexpectedSearchEndpoint(url),
    );

    renderResearch(departments, ['/research?q=machine+learning']);

    expect((screen.getByLabelText('Search Yale research') as HTMLInputElement).value).toBe(
      'machine learning',
    );
    expect(await screen.findByText("Showing research matches for 'machine learning'")).toBeTruthy();
    expect(mockedAxios.post).toHaveBeenCalledWith(
      '/research/search',
      expect.objectContaining({
        q: 'machine learning',
        filters: {},
      }),
      expect.any(Object),
    );
    expect(mockedAxios.post.mock.calls.some(([url]) => url === '/pathways/search')).toBe(false);
  });

  it('keeps initial q searches alive under StrictMode effect cleanup', async () => {
    mockSearchResponses((url) =>
      url === '/research/search'
        ? researchSearchResponse([researchEntity])
        : unexpectedSearchEndpoint(url),
    );

    renderResearchStrict(departments, ['/research?q=machine+learning']);

    expect(await screen.findByText("Showing research matches for 'machine learning'")).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'AI Safety Lab' })).toBeTruthy();
  });

  it('reveals one research-home result stream with inline ways-in context after a search', async () => {
    mockSearchResponses((url, body) => {
      if (body.q === 'protein folding') {
        return url === '/research/search'
          ? researchSearchResponse([{ ...researchEntity, waysIn: [pathwayHit] }])
          : unexpectedSearchEndpoint(url);
      }

      return url === '/research/search' ? researchSearchResponse() : unexpectedSearchEndpoint(url);
    });

    const { container } = renderResearch();

    fireEvent.change(screen.getByLabelText('Search Yale research'), {
      target: { value: 'protein folding' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await screen.findByText("Showing research matches for 'protein folding'");

    expect(screen.getByRole('status').textContent).toContain(
      '1 research home, 1 way in, 1 contact',
    );
    expect(screen.queryByRole('link', { name: /Compare .*pathway/i })).toBeNull();
    expect(container.textContent).toContain('Research homes');
    expect(container.textContent).not.toContain('How to use this');
    expect(container.textContent).not.toContain('Popular starting points');
    expect(container.textContent).not.toContain('Topic term: protein');
    expect(container.textContent).not.toContain('Papers via profiles');
    expect(container.textContent).not.toContain('People and Contacts');
    expect(container.textContent).not.toContain('Pathway Preview');
    expect(container.textContent).not.toContain('View all matching pathways');
    expect(container.textContent).not.toContain('No pathways indexed yet');
    expect(container.textContent).not.toContain('Best Next Steps');
    expect(container.textContent).not.toContain('Cluster: experimental');
    expect(container.textContent).not.toContain('POSTED_OPENING');
    expect(container.textContent).toContain('AI Safety Lab');
    expect(container.textContent).toContain('Studies reliable machine learning systems.');
    expect(container.textContent).toContain('Computer Science · Yale College');
    expect(container.textContent).not.toContain('Why it might fit');
    expect(container.textContent).not.toContain('Official Yale source found');
    const searchSection = screen.getByLabelText('Search results');
    const searchGrid = searchSection.querySelector('.grid.gap-3');
    expect(searchGrid?.className).toContain('lg:grid-cols-2');
    expect(searchGrid?.className).toContain('2xl:grid-cols-[repeat(3,minmax(0,1fr))]');
    expect(searchGrid?.className).not.toContain('items-start');
    expect(searchGrid?.className).not.toContain('xl:grid-cols-3');
    expect(
      screen
        .getAllByRole('link', { name: 'AI Safety Lab' })
      .some((link) => link.getAttribute('href') === '/research/ai-safety-lab'),
    ).toBe(true);
    expect(container.textContent).toContain('Plan targeted outreach');
    expect(container.textContent).toContain('Contact route');
    expect(container.textContent).not.toContain('Contact the program manager.');

    await waitFor(() => {
      expect(mockedAxios.post).toHaveBeenCalledWith(
        '/research/search',
        expect.any(Object),
        expect.any(Object),
      );
      expect(mockedAxios.post.mock.calls.some(([url]) => url === '/pathways/search')).toBe(false);
    });
  });

  it('does not expose unsupported ways-in filters as factual refinements', async () => {
    const nonMatchingEntity = {
      ...researchEntity,
      _id: 'entity-2',
      slug: 'archives-lab',
      name: 'Archives Lab',
      displayName: 'Archives Lab',
      description: 'Studies archival collections.',
      departments: ['History of Art'],
      researchAreas: ['Archival research'],
    };
    const postedPathway = {
      ...pathwayHit,
      pathwayType: 'POSTED_ROLE',
      bestNextStepCategory: 'apply',
      compensation: 'STIPEND',
      activePostedOpportunity: {
        _id: 'opportunity-1',
        title: 'Summer RA role',
        status: 'OPEN',
        provenance: 'SCRAPER_DERIVED',
      },
      evidence: [
        {
          signalType: 'POSTED_OPENING',
          sourceUrl: 'https://example.edu/ai-safety',
          excerpt: 'Summer RA role.',
          confidenceScore: 1,
        },
      ],
    };

    mockSearchResponses((url, body) => {
      if (body.q === 'machine learning') {
        return url === '/research/search'
          ? researchSearchResponse([
              { ...researchEntity, waysIn: [postedPathway] },
              nonMatchingEntity,
            ])
          : unexpectedSearchEndpoint(url);
      }

      return url === '/research/search' ? researchSearchResponse() : unexpectedSearchEndpoint(url);
    });

    const { container } = renderResearch();

    fireEvent.change(screen.getByLabelText('Search Yale research'), {
      target: { value: 'machine learning' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await screen.findByText("Showing research matches for 'machine learning'");
    expect(screen.queryByRole('button', { name: 'Open roles' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Paid/funded' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Thesis possible' })).toBeNull();
    expect(container.textContent).toContain('AI Safety Lab');
    expect(container.textContent).toContain('Archives Lab');
    expect(container.textContent).toContain('Posted route');
    expect(container.textContent).not.toContain('Open role');
    expect(container.textContent).not.toContain('Paid/funded');
    expect(container.textContent).not.toContain('Thesis fit');
    expect(screen.getByRole('link', { name: 'View posted opportunity' }).getAttribute('href')).toBe(
      '/opportunities/opportunity-1',
    );
    expect(container.textContent).not.toContain('Pathway Preview');
    expect(container.textContent).not.toContain('Compare pathways');
  });

  it('keeps research homes useful when pathway enrichment is sparse', async () => {
    mockSearchResponses((url, body) => {
      if (body.q === 'machine learning') {
        return url === '/research/search'
          ? researchSearchResponse([
            {
              ...researchEntity,
              contactName: '',
              contactRole: '',
            },
          ])
          : unexpectedSearchEndpoint(url);
      }

      return url === '/research/search' ? researchSearchResponse() : unexpectedSearchEndpoint(url);
    });

    const { container } = renderResearch();

    fireEvent.change(screen.getByLabelText('Search Yale research'), {
      target: { value: 'machine learning' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await screen.findByText("Showing research matches for 'machine learning'");

    expect(screen.queryByText('No pathways indexed yet')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Compare 0 pathways' })).toBeNull();
    expect(container.textContent).toContain('AI Safety Lab');
    expect(container.textContent).not.toContain('Evidence sparse');
    expect(container.textContent).not.toContain('People and Contacts');
    expect(container.textContent).not.toContain('People and Contacts0');
  });

  it('renders semantic research search results as profile-opening homes without duplicate match copy', async () => {
    mockSearchResponses((url, body) => {
      if (body.q === 'digital humanities') {
        return url === '/research/search'
          ? researchSearchResponse([
            {
              ...researchEntity,
              _id: 'entity-2',
              id: 'entity-2',
              slug: 'digital-humanities-lab',
              name: 'Yale Digital Humanities Lab',
              displayName: 'Yale Digital Humanities Lab',
              description: 'Computational text analysis and archive-centered research.',
              departments: ['English'],
              researchAreas: ['digital humanities'],
              sourceUrls: ['https://example.yale.edu'],
              searchMatch: {
                mode: 'hybrid',
                concepts: ['digital humanities'],
                methods: ['computational text analysis'],
                reason: 'Matches computational text analysis, digital humanities.',
              },
            },
          ])
          : unexpectedSearchEndpoint(url);
      }

      return url === '/research/search' ? researchSearchResponse() : unexpectedSearchEndpoint(url);
    });

    renderResearch();

    fireEvent.change(screen.getByLabelText('Search Yale research'), {
      target: { value: 'digital humanities' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(
      await screen.findByRole('heading', { name: 'Yale Digital Humanities Lab' }),
    ).toBeTruthy();
    expect(screen.queryByText('Why this matches: Matches computational text analysis, digital humanities.')).toBeNull();
    expect(screen.queryByText('Matches computational text analysis, digital humanities.')).toBeNull();
    expect(screen.getByRole('link', { name: 'Yale Digital Humanities Lab' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View profile →' }).getAttribute('href')).toBe(
      '/research/digital-humanities-lab',
    );
  });

  it('renders research metadata without a separate pathway fallback request', async () => {
    mockSearchResponses((url, body) => {
      if (body.q === 'protein folding') {
        return url === '/research/search'
          ? researchSearchResponse([researchEntity])
          : unexpectedSearchEndpoint(url);
      }

      return url === '/research/search' ? researchSearchResponse() : unexpectedSearchEndpoint(url);
    });

    const { container } = renderResearch();

    fireEvent.change(screen.getByLabelText('Search Yale research'), {
      target: { value: 'protein folding' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await screen.findByText("Showing research matches for 'protein folding'");
    expect(screen.queryByRole('alert')).toBeNull();
    expect(container.textContent || '').toContain('AI Safety Lab');
    expect(mockedAxios.post.mock.calls.some(([url]) => url === '/pathways/search')).toBe(false);
  });

  it('keeps loaded browse results when returning from a research profile', async () => {
    mockSearchResponses((url) =>
      url === '/research/search'
        ? researchSearchResponse([researchEntity])
        : unexpectedSearchEndpoint(url),
    );

    renderResearchWithDetailRoute();

    expect(await screen.findByRole('heading', { name: 'AI Safety Lab' })).toBeTruthy();
    const initialSearchCalls = mockedAxios.post.mock.calls.length;
    expect(initialSearchCalls).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('link', { name: 'View profile →' }));
    expect(await screen.findByRole('heading', { name: 'Research profile' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Back to research' }));

    expect(await screen.findByRole('heading', { name: 'AI Safety Lab' })).toBeTruthy();
    expect(mockedAxios.post).toHaveBeenCalledTimes(initialSearchCalls);
  });

});
