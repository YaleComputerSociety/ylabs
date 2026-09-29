import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState, type MouseEvent } from 'react';

import Fellowships from '../fellowships';
import FellowshipSearchContext, {
  FellowshipSearchContextType,
} from '../../contexts/FellowshipSearchContext';
import UserContext from '../../contexts/UserContext';
import UIContext, { defaultUIContext } from '../../contexts/UIContext';
import type { Fellowship } from '../../types/types';
import { summarizeProgramJourney } from '../../utils/programJourney';
import axios from '../../utils/axios';
import { trackResearchEvent } from '../../utils/researchAnalytics';
import swal from 'sweetalert';

vi.mock('../../utils/axios', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('sweetalert', () => ({ default: vi.fn() }));

vi.mock('../../utils/researchAnalytics', async () => ({
  ...(await vi.importActual<typeof import('../../utils/researchAnalytics')>(
    '../../utils/researchAnalytics',
  )),
  trackResearchEvent: vi.fn(),
}));

vi.mock('../../components/shared/BrowseGrid', () => ({
  default: ({
    items,
    favIds = [],
    onToggleFavorite,
    onOpenModal,
    emptyMessage,
  }: {
    items: Array<{ type: 'fellowship'; data: Fellowship }>;
    favIds?: string[];
    onToggleFavorite?: (id: string, event: MouseEvent) => void;
    onOpenModal?: (item: { type: 'fellowship'; data: Fellowship }) => void;
    emptyMessage: string;
  }) => (
    <section aria-label={emptyMessage}>
      {items.map((item) => (
        <article key={item.data.id}>
          <span>{item.data.title}</span>
          {onOpenModal && (
            <button
              type="button"
              aria-label={`Open program ${item.data.id}`}
              onClick={() => onOpenModal(item)}
            >
              Open
            </button>
          )}
          {onToggleFavorite && (
            <button
              type="button"
              aria-label={
                favIds.includes(item.data.id)
                  ? `Saved program ${item.data.id}`
                  : `Save program ${item.data.id}`
              }
              onClick={(event) => onToggleFavorite(item.data.id, event)}
            >
              {favIds.includes(item.data.id) ? 'Saved' : 'Save'}
            </button>
          )}
        </article>
      ))}
    </section>
  ),
}));

vi.mock('../../components/fellowship/FellowshipModal', () => ({
  default: ({
    fellowship,
    isOpen,
    onClose,
  }: {
    fellowship: Fellowship;
    isOpen: boolean;
    onClose: () => void;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={fellowship.title}>
        <span>{fellowship.title}</span>
        <button type="button" aria-label="Close" onClick={onClose}>
          Close
        </button>
      </div>
    ) : null,
}));

vi.mock('../../components/admin/AdminFellowshipEditModal', () => ({
  default: () => null,
}));

const mockedAxios = axios as unknown as {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverMock as any;

const isoDaysFromNow = (days: number) =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

const baseFellowship = (overrides: Partial<Fellowship> = {}): Fellowship => ({
  id: 'f1',
  title: 'Summer Research Fellowship',
  programCategory: 'FELLOWSHIP',
  programKind: 'FELLOWSHIP_FUNDING',
  entryMode: 'SECURE_MENTOR_THEN_APPLY',
  studentFacingCategory: 'Funding after mentor',
  requiresMentorBeforeApply: true,
  mentorMatching: false,
  undergraduateOnly: true,
  yaleCollegeOnly: true,
  compensationSummary: '',
  hoursPerWeek: null,
  programDates: '',
  bestNextStep: 'Find a mentor before applying.',
  prepSteps: ['Faculty mentor', 'Research proposal'],
  competitionType: 'Fellowship',
  summary: 'Annual funding for undergraduate research projects.',
  description: '',
  applicationInformation: '',
  eligibility: '',
  restrictionsToUseOfAward: '',
  additionalInformation: '',
  links: [{ label: 'Program page', url: 'https://example.edu/fellowship' }],
  applicationLink: 'https://example.edu/apply',
  awardAmount: '',
  isAcceptingApplications: false,
  applicationOpenDate: null,
  deadline: null,
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  contactOffice: '',
  yearOfStudy: ['Junior'],
  termOfAward: ['Summer'],
  purpose: ['Research'],
  globalRegions: [],
  citizenshipStatus: [],
  sourceName: 'Yale',
  sourceUrl: 'https://example.edu/fellowship',
  sourceKey: 'example',
  sourceFingerprint: 'fingerprint',
  sourceLastVerifiedAt: null,
  sourceLastChangedAt: null,
  archived: false,
  audited: false,
  views: 0,
  favorites: 0,
  updatedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const HistoryControls = () => {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <button type="button" onClick={() => void navigate(-1)}>
        Browser back
      </button>
      <button type="button" onClick={() => void navigate(1)}>
        Browser forward
      </button>
      <span data-testid="current-location">{`${location.pathname}${location.search}`}</span>
    </>
  );
};

const renderPage = (
  fellowships: Fellowship[],
  overrides: Partial<FellowshipSearchContextType> = {},
  initialEntries: string[] = ['/programs'],
  initialIndex: number = initialEntries.length - 1,
) => {
  if (!mockedAxios.get.getMockImplementation()) {
    mockedAxios.get.mockResolvedValue({ data: { watchedProgramIds: [] } });
  }

  const value: FellowshipSearchContextType = {
    queryString: '',
    setQueryString: vi.fn(),
    selectedProgramCategory: [],
    setSelectedProgramCategory: vi.fn(),
    selectedProgramKind: [],
    setSelectedProgramKind: vi.fn(),
    selectedEntryMode: [],
    setSelectedEntryMode: vi.fn(),
    selectedStudentFacingCategory: [],
    setSelectedStudentFacingCategory: vi.fn(),
    selectedYearOfStudy: [],
    setSelectedYearOfStudy: vi.fn(),
    selectedTermOfAward: [],
    setSelectedTermOfAward: vi.fn(),
    selectedPurpose: [],
    setSelectedPurpose: vi.fn(),
    selectedRegions: [],
    setSelectedRegions: vi.fn(),
    selectedCitizenship: [],
    setSelectedCitizenship: vi.fn(),
    selectedStudentVisibilityTier: [],
    setSelectedStudentVisibilityTier: vi.fn(),
    sortBy: 'default',
    setSortBy: vi.fn(),
    sortOrder: -1,
    setSortOrder: vi.fn(),
    sortDirection: 'desc' as const,
    onToggleSortDirection: vi.fn(),
    fellowships,
    isLoading: false,
    loadError: false,
    searchExhausted: true,
    page: 1,
    setPage: vi.fn(),
    pageSize: 500,
    total: fellowships.length,
    journeySummary: summarizeProgramJourney(fellowships),
    filterOptions: {
      programCategory: [],
      programKind: [],
      entryMode: [],
      studentFacingCategory: [],
      yearOfStudy: [],
      termOfAward: [],
      purpose: [],
      globalRegions: [],
      citizenshipStatus: [],
    },
    sortableKeys: ['default'],
    refreshFellowships: vi.fn(),
    quickFilter: null,
    setQuickFilter: vi.fn(),
    resetProgramFilters: vi.fn(),
    filterBarHeight: 0,
    setFilterBarHeight: vi.fn(),
    ...overrides,
    selectedSubjects: overrides.selectedSubjects ?? [],
    setSelectedSubjects: overrides.setSelectedSubjects ?? vi.fn(),
  };

  return render(
    <MemoryRouter initialEntries={initialEntries} initialIndex={initialIndex}>
      <HistoryControls />
      <UserContext.Provider
        value={{
          isLoading: false,
          isAuthenticated: true,
          user: { userType: 'student' } as any,
          checkContext: vi.fn(),
        }}
      >
        <UIContext.Provider value={defaultUIContext}>
          <FellowshipSearchContext.Provider value={value}>
            <Routes>
              <Route path="/programs" element={<Fellowships />} />
              <Route path="/previous" element={<p>Previous page</p>} />
            </Routes>
          </FellowshipSearchContext.Provider>
        </UIContext.Provider>
      </UserContext.Provider>
    </MemoryRouter>,
  );
};

const renderStatefulPage = (fellowships: Fellowship[]) => {
  mockedAxios.get.mockResolvedValue({ data: { watchedProgramIds: [] } });

  const Harness = () => {
    const [sortBy, setSortBy] = useState('default');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
    const [quickFilter, setQuickFilter] = useState<string | null>(null);

    return (
      <MemoryRouter>
        <UserContext.Provider
          value={{
            isLoading: false,
            isAuthenticated: true,
            user: { userType: 'student' } as any,
            checkContext: vi.fn(),
          }}
        >
          <UIContext.Provider value={defaultUIContext}>
            <FellowshipSearchContext.Provider
              value={{
                queryString: '',
                setQueryString: vi.fn(),
                selectedProgramCategory: [],
                setSelectedProgramCategory: vi.fn(),
                selectedProgramKind: [],
                setSelectedProgramKind: vi.fn(),
                selectedEntryMode: [],
                setSelectedEntryMode: vi.fn(),
                selectedStudentFacingCategory: [],
                setSelectedStudentFacingCategory: vi.fn(),
                selectedSubjects: [],
                setSelectedSubjects: vi.fn(),
                selectedYearOfStudy: [],
                setSelectedYearOfStudy: vi.fn(),
                selectedTermOfAward: [],
                setSelectedTermOfAward: vi.fn(),
                selectedPurpose: [],
                setSelectedPurpose: vi.fn(),
                selectedRegions: [],
                setSelectedRegions: vi.fn(),
                selectedCitizenship: [],
                setSelectedCitizenship: vi.fn(),
                selectedStudentVisibilityTier: [],
                setSelectedStudentVisibilityTier: vi.fn(),
                sortBy,
                setSortBy,
                sortOrder: sortDirection === 'asc' ? 1 : -1,
                setSortOrder: vi.fn(),
                sortDirection,
                onToggleSortDirection: () =>
                  setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc')),
                fellowships,
                isLoading: false,
                loadError: false,
                searchExhausted: true,
                page: 1,
                setPage: vi.fn(),
                pageSize: 500,
                total: fellowships.length,
                journeySummary: summarizeProgramJourney(fellowships),
                filterOptions: {
                  programCategory: ['FELLOWSHIP', 'SUMMER_RESEARCH_PROGRAM'],
                  programKind: ['FELLOWSHIP_FUNDING', 'STRUCTURED_PROGRAM'],
                  entryMode: ['SECURE_MENTOR_THEN_APPLY', 'APPLY_TO_PROGRAM'],
                  studentFacingCategory: ['Funding after mentor', 'Structured program'],
                  yearOfStudy: ['Junior', 'Senior'],
                  termOfAward: ['Summer'],
                  purpose: ['Research'],
                  globalRegions: [],
                  citizenshipStatus: [],
                },
                sortableKeys: ['default', 'deadline', 'createdAt', 'title'],
                refreshFellowships: vi.fn(),
                quickFilter,
                setQuickFilter,
                resetProgramFilters: () => setQuickFilter(null),
                filterBarHeight: 0,
                setFilterBarHeight: vi.fn(),
              }}
            >
              <Fellowships />
            </FellowshipSearchContext.Provider>
          </UIContext.Provider>
        </UserContext.Provider>
      </MemoryRouter>
    );
  };

  return render(<Harness />);
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockedAxios.get.mockReset();
  localStorage.clear();
});

describe('Programs page', () => {
  it('frames programs and fellowships as structured application planning with status counts', async () => {
    renderPage([
      baseFellowship({
        id: 'closing',
        title: 'Closing Soon Fellowship',
        isAcceptingApplications: true,
        deadline: isoDaysFromNow(15),
      }),
      baseFellowship({
        id: 'open',
        title: 'Open Fellowship',
        isAcceptingApplications: true,
        deadline: isoDaysFromNow(60),
      }),
      baseFellowship({
        id: 'next-cycle',
        title: 'Next Cycle Fellowship',
        programKind: 'OTHER',
        entryMode: 'UNKNOWN',
        studentFacingCategory: 'Program record',
        requiresMentorBeforeApply: false,
        isAcceptingApplications: false,
        deadline: isoDaysFromNow(-30),
      }),
    ]);

    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith('/users/watchedProgramIds', {
        withCredentials: true,
      });
    });

    expect(screen.getByRole('heading', { name: 'Programs & Fellowships' })).toBeTruthy();
    expect(
      screen.getByText(/track structured applications, recurring research programs/i),
    ).toBeTruthy();
    expect(screen.getByText('Apply now')).toBeTruthy();
    expect(screen.getByText('Opening soon')).toBeTruthy();
    expect(screen.getByText('Structured programs')).toBeTruthy();
    expect(screen.getByText('Funding after mentor')).toBeTruthy();
    expect(screen.getByText('Plan next cycle')).toBeTruthy();
    expect(screen.getByText('Archive / review')).toBeTruthy();
    expect(screen.queryByText('Likely next cycle')).toBeNull();
    expect(screen.getByText('Open Fellowship')).toBeTruthy();
    expect(screen.getByText('Next Cycle Fellowship')).toBeTruthy();
  });

  it('shows full-set journey partition counts in the stat tiles rather than the loaded page count', async () => {
    const journeySummary = {
      applyNow: 20,
      openingSoon: 7,
      structured: 40,
      fundingAfterMentor: 30,
      nextCycle: 3,
      archive: 33,
    };
    const total = Object.values(journeySummary).reduce((sum, value) => sum + value, 0);

    renderPage(
      [
        baseFellowship({
          id: 'solo',
          title: 'Solo Loaded Program',
          isAcceptingApplications: false,
          deadline: isoDaysFromNow(-10),
        }),
      ],
      { total, journeySummary },
    );

    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith('/users/watchedProgramIds', {
        withCredentials: true,
      });
    });

    expect(total).toBe(133);
    expect(screen.getByText('20')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('40')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('33')).toBeTruthy();
    expect(screen.getAllByText('30').length).toBeGreaterThanOrEqual(2);
  });

  it('keeps each stat tile equal to its matching journey section header', async () => {
    const fellowships = [
      baseFellowship({
        id: 'apply-now',
        title: 'Open Apply Program',
        programKind: 'STRUCTURED_PROGRAM',
        requiresMentorBeforeApply: false,
        studentFacingCategory: 'Structured program',
        isAcceptingApplications: true,
        deadline: isoDaysFromNow(60),
      }),
      baseFellowship({
        id: 'structured',
        title: 'Structured Program Record',
        programKind: 'STRUCTURED_PROGRAM',
        requiresMentorBeforeApply: false,
        studentFacingCategory: 'Structured program',
        isAcceptingApplications: false,
        deadline: isoDaysFromNow(-40),
      }),
      baseFellowship({
        id: 'funding',
        title: 'Funding After Mentor Record',
        isAcceptingApplications: false,
        deadline: isoDaysFromNow(-40),
      }),
    ];

    renderPage(fellowships);

    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith('/users/watchedProgramIds', {
        withCredentials: true,
      });
    });

    const summary = summarizeProgramJourney(fellowships);
    expect(Object.values(summary).reduce((sum, value) => sum + value, 0)).toBe(fellowships.length);

    for (const [title, key] of [
      ['Apply Now', 'applyNow'],
      ['Structured Research Programs', 'structured'],
      ['Funding After You Have a Mentor', 'fundingAfterMentor'],
    ] as const) {
      if (summary[key] === 0) continue;
      const header = screen.getByRole('heading', { name: title }).parentElement;
      expect(header?.textContent).toContain(String(summary[key]));
    }
  });

  it('renders the Apply Now section on first paint when an open program is present among closed records', async () => {
    const fellowships = [
      ...Array.from({ length: 40 }, (_, index) =>
        baseFellowship({
          id: `closed-${index}`,
          title: `Closed Program ${index}`,
          isAcceptingApplications: false,
          deadline: isoDaysFromNow(-40),
        }),
      ),
      baseFellowship({
        id: 'open-late',
        title: 'Open Late Program',
        isAcceptingApplications: true,
        deadline: isoDaysFromNow(60),
      }),
    ];

    renderPage(fellowships);

    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith('/users/watchedProgramIds', {
        withCredentials: true,
      });
    });

    const applyNowHeader = screen.getByRole('heading', { name: 'Apply Now' });
    expect(applyNowHeader.parentElement?.textContent).toContain('1');
    expect(screen.getByText('Open Late Program')).toBeTruthy();
  });

  it('renders program controls on the page and wires filter selection to program context', async () => {
    const setSelectedYearOfStudy = vi.fn();
    renderPage(
      [baseFellowship({ id: 'open', title: 'Open Fellowship', isAcceptingApplications: true })],
      {
        filterOptions: {
          programCategory: ['FELLOWSHIP', 'SUMMER_RESEARCH_PROGRAM'],
          programKind: ['FELLOWSHIP_FUNDING', 'STRUCTURED_PROGRAM'],
          entryMode: ['SECURE_MENTOR_THEN_APPLY', 'APPLY_TO_PROGRAM'],
          studentFacingCategory: ['Funding after mentor', 'Structured program'],
          yearOfStudy: ['Junior', 'Senior'],
          termOfAward: ['Summer'],
          purpose: ['Research'],
          globalRegions: [],
          citizenshipStatus: [],
        },
        setSelectedYearOfStudy,
      },
    );

    const searchInput = screen.getByLabelText('Search programs and fellowships');
    expect(searchInput.className).toContain('min-h-[44px]');
    await userEvent.type(searchInput, 'summer');
    expect(screen.getByRole('button', { name: /filters/i }).className).toContain('min-h-[44px]');
    expect(screen.getByRole('button', { name: /sort/i }).className).toContain('min-h-[44px]');
    expect(screen.getByRole('button', { name: 'Open Only' }).className).toContain('min-h-[44px]');

    await userEvent.click(screen.getByRole('button', { name: /filters/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Year' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Senior' }));

    expect(setSelectedYearOfStudy).toHaveBeenCalled();
    const update = setSelectedYearOfStudy.mock.calls[0][0];
    expect(typeof update).toBe('function');
    expect(update([])).toEqual(['Senior']);
    expect(screen.queryByRole('option')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open Only' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('status')).toHaveTextContent('1 result');
  });

  it('clears the subject filter along with every other program filter from Clear all', async () => {
    const resetProgramFilters = vi.fn();
    const setSelectedStudentVisibilityTier = vi.fn();
    renderPage([baseFellowship({ id: 'open', title: 'Open Fellowship' })], {
      selectedSubjects: ['Biology'],
      resetProgramFilters,
      setSelectedStudentVisibilityTier,
    });

    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }));

    expect(resetProgramFilters).toHaveBeenCalledTimes(1);
    expect(setSelectedStudentVisibilityTier).toHaveBeenCalledWith([]);
  });

  it('contains mobile filter focus and restores the trigger on Escape', async () => {
    renderPage(
      [baseFellowship({ id: 'open', title: 'Open Fellowship', isAcceptingApplications: true })],
      {
        filterOptions: {
          programCategory: [],
          programKind: ['STRUCTURED_PROGRAM'],
          entryMode: [],
          studentFacingCategory: [],
          yearOfStudy: [],
          termOfAward: [],
          purpose: [],
          globalRegions: [],
          citizenshipStatus: [],
        },
      },
    );

    const trigger = screen.getByRole('button', { name: /filters/i });
    await userEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Program filters' });
    expect(dialog.className).toContain('fixed');
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Close filters' })).toHaveFocus(),
    );

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Program filters' })).toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());

    const searchInput = screen.getByLabelText('Search programs and fellowships');
    searchInput.focus();
    expect(searchInput).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(searchInput).toHaveFocus();
  });

  it('starts desktop filter focus on the first visible tab', async () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;

    try {
      renderPage(
        [baseFellowship({ id: 'open', title: 'Open Fellowship', isAcceptingApplications: true })],
        {
          filterOptions: {
            programCategory: [],
            programKind: ['STRUCTURED_PROGRAM'],
            entryMode: [],
            studentFacingCategory: [],
            yearOfStudy: [],
            termOfAward: [],
            purpose: [],
            globalRegions: [],
            citizenshipStatus: [],
          },
        },
      );

      await userEvent.click(screen.getByRole('button', { name: /filters/i }));
      const dialog = screen.getByRole('dialog', { name: 'Program filters' });
      await waitFor(() =>
        expect(within(dialog).getByRole('button', { name: 'Journey' })).toHaveFocus(),
      );
      expect(within(dialog).getByRole('button', { name: 'Close filters' })).not.toHaveFocus();
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it('sorts visible program cards inside their cycle section from local sort controls', async () => {
    renderStatefulPage([
      baseFellowship({
        id: 'zeta',
        title: 'Zeta Open Fellowship',
        isAcceptingApplications: true,
        deadline: isoDaysFromNow(30),
      }),
      baseFellowship({
        id: 'alpha',
        title: 'Alpha Open Fellowship',
        isAcceptingApplications: true,
        deadline: isoDaysFromNow(60),
      }),
    ]);

    await userEvent.click(screen.getByRole('button', { name: /sort/i }));
    await userEvent.click(screen.getByText('Name'));
    await userEvent.click(screen.getByRole('button', { name: /sort descending/i }));

    const openSection = screen.getByRole('region', { name: 'No apply now records' });
    expect(
      within(openSection)
        .getAllByRole('article')
        .map((node) => within(node).getByText(/Open Fellowship$/).textContent),
    ).toEqual(['Alpha Open Fellowship', 'Zeta Open Fellowship']);
  });

  it('keeps quick filters local to the program page sections', async () => {
    renderStatefulPage([
      baseFellowship({
        id: 'closing',
        title: 'Closing Soon Fellowship',
        isAcceptingApplications: true,
        deadline: isoDaysFromNow(15),
      }),
      baseFellowship({
        id: 'open',
        title: 'Open Fellowship',
        isAcceptingApplications: true,
        deadline: isoDaysFromNow(60),
      }),
      baseFellowship({
        id: 'next-cycle',
        title: 'Next Cycle Fellowship',
        programKind: 'OTHER',
        entryMode: 'UNKNOWN',
        studentFacingCategory: 'Program record',
        requiresMentorBeforeApply: false,
        isAcceptingApplications: false,
        deadline: isoDaysFromNow(-30),
      }),
    ]);

    await userEvent.click(screen.getByRole('button', { name: /Next Cycle/i }));

    expect(screen.queryByText('Open Fellowship')).toBeNull();
    expect(screen.queryByText('Closing Soon Fellowship')).toBeNull();
    expect(screen.getByText('Next Cycle Fellowship')).toBeTruthy();
  });

  it('updates the results counter and shows next-cycle guidance when Open Only has no matches', async () => {
    renderStatefulPage([
      baseFellowship({
        id: 'next-cycle',
        title: 'Next Cycle Fellowship',
        programKind: 'OTHER',
        entryMode: 'UNKNOWN',
        studentFacingCategory: 'Program record',
        requiresMentorBeforeApply: false,
        isAcceptingApplications: false,
        deadline: isoDaysFromNow(-30),
      }),
    ]);

    expect(screen.getByText('1 result')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /Open Only/i }));

    expect(screen.getByText('0 results')).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'No application windows are open right now' }),
    ).toBeTruthy();
    expect(screen.getByText(/Use Next Cycle to track recurring opportunities/i)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'View Next Cycle' }));

    expect(screen.getByText('Next Cycle Fellowship')).toBeTruthy();
    expect(screen.getByText('1 result')).toBeTruthy();
  });

  it('updates the results counter and explains when no deadlines are closing soon', async () => {
    renderStatefulPage([
      baseFellowship({
        id: 'next-cycle',
        title: 'Next Cycle Fellowship',
        programKind: 'OTHER',
        entryMode: 'UNKNOWN',
        studentFacingCategory: 'Program record',
        requiresMentorBeforeApply: false,
        isAcceptingApplications: false,
        deadline: isoDaysFromNow(-30),
      }),
    ]);

    await userEvent.click(screen.getByRole('button', { name: /Closing Soon/i }));

    expect(screen.getByText('0 results')).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'No application windows are closing soon' }),
    ).toBeTruthy();
    expect(screen.getByText(/due in the next 30 days/i)).toBeTruthy();
  });

  it('shows the first-save callout with a dashboard next step', async () => {
    mockedAxios.put.mockResolvedValue({ data: {} });
    renderPage([
      baseFellowship({
        id: 'open',
        title: 'Open Fellowship',
        isAcceptingApplications: true,
        deadline: isoDaysFromNow(60),
      }),
    ]);

    await userEvent.click(await screen.findByRole('button', { name: 'Save program open' }));

    expect(screen.getByText('Program saved')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Dashboard' }).getAttribute('href')).toBe(
      '/dashboard',
    );
    expect(mockedAxios.put).toHaveBeenCalledWith('/users/watchedPrograms', {
      withCredentials: true,
      data: { watchedPrograms: ['open'] },
    });
  });

  it('does not repeat the program first-save callout after the first acknowledgement', async () => {
    localStorage.setItem('yale-research.firstSave.program.v1', 'true');
    mockedAxios.put.mockResolvedValue({ data: {} });
    renderPage([
      baseFellowship({
        id: 'open',
        title: 'Open Fellowship',
        isAcceptingApplications: true,
        deadline: isoDaysFromNow(60),
      }),
    ]);

    await userEvent.click(await screen.findByRole('button', { name: 'Save program open' }));

    expect(screen.queryByText('Program saved')).toBeNull();
  });

  it('opens a deep-linked program once and keeps it closed after dismissal', async () => {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url === '/programs/f1') {
        return Promise.resolve({
          data: { program: baseFellowship({ id: 'f1', title: 'Deep Linked Program' }) },
        });
      }
      return Promise.resolve({ data: { watchedProgramIds: [] } });
    });

    renderPage([], {}, ['/programs?program=f1']);

    const dialog = await screen.findByRole('dialog', { name: 'Deep Linked Program' });
    expect(within(dialog).getByText('Deep Linked Program')).toBeTruthy();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Deep Linked Program' })).toBeNull(),
    );
    expect(screen.queryByRole('dialog', { name: 'Deep Linked Program' })).toBeNull();

    const detailFetches = mockedAxios.get.mock.calls.filter((call) => call[0] === '/programs/f1');
    expect(detailFetches).toHaveLength(1);
  });

  it('records one view for a program opened from a direct link, keyed by its stored id', async () => {
    mockedAxios.put.mockResolvedValue({ data: {} });
    mockedAxios.get.mockImplementation((url: string) => {
      if (url === '/programs/f1') {
        const { id: _id, ...stored } = baseFellowship({ id: 'f1', title: 'Deep Linked Program' });
        return Promise.resolve({ data: { program: { ...stored, _id: 'f1' } } });
      }
      return Promise.resolve({ data: { watchedProgramIds: [] } });
    });

    renderPage([], {}, ['/programs?program=f1']);

    await screen.findByRole('dialog', { name: 'Deep Linked Program' });
    await waitFor(() =>
      expect(mockedAxios.put.mock.calls.map((call) => call[0])).toEqual(['fellowships/f1/addView']),
    );
  });

  describe('watching programs', () => {
    const twoPrograms = () => [
      baseFellowship({ id: 'program-a', title: 'Synthetic Program A' }),
      baseFellowship({ id: 'program-b', title: 'Synthetic Program B' }),
    ];

    it('a failed watch does not revert a different program that saved', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      localStorage.setItem('yale-research.firstSave.program.v1', 'true');
      const serverWatchedIds: string[] = [];
      mockedAxios.get.mockImplementation((url: string) =>
        Promise.resolve({
          data:
            url === '/users/watchedProgramIds' ? { watchedProgramIds: [...serverWatchedIds] } : {},
        }),
      );
      let rejectA: (reason: unknown) => void = () => {};
      mockedAxios.put.mockImplementation((_url: string, body: any) => {
        const [id] = body.data.watchedPrograms;
        if (id === 'program-a') {
          return new Promise((_resolve, reject) => {
            rejectA = reject;
          });
        }
        serverWatchedIds.push(id);
        return Promise.resolve({ data: {} });
      });
      renderPage(twoPrograms());

      await userEvent.click(await screen.findByRole('button', { name: 'Save program program-a' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Save program program-b' }));
      expect(await screen.findByRole('button', { name: 'Saved program program-b' })).toBeTruthy();

      rejectA(new Error('network'));
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Saved program program-a' })).toBeNull(),
      );
      expect(screen.queryByRole('button', { name: 'Saved program program-b' })).toBeTruthy();
    });

    it('tells the student when a watch could not be saved', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      localStorage.setItem('yale-research.firstSave.program.v1', 'true');
      mockedAxios.put.mockRejectedValue(new Error('network'));
      renderPage(twoPrograms());

      await userEvent.click(await screen.findByRole('button', { name: 'Save program program-a' }));

      await waitFor(() =>
        expect(swal).toHaveBeenCalledWith(
          expect.objectContaining({ icon: 'warning', text: expect.stringMatching(/program/i) }),
        ),
      );
    });

    it('keeps a watch made before the watched list finished loading', async () => {
      localStorage.setItem('yale-research.firstSave.program.v1', 'true');
      let resolveIds: (value: unknown) => void = () => {};
      mockedAxios.get.mockImplementation((url: string) =>
        url === '/users/watchedProgramIds'
          ? new Promise((resolve) => {
              resolveIds = resolve;
            })
          : Promise.resolve({ data: {} }),
      );
      mockedAxios.put.mockResolvedValue({ data: {} });
      renderPage(twoPrograms());

      await userEvent.click(await screen.findByRole('button', { name: 'Save program program-a' }));
      await waitFor(() => expect(mockedAxios.put).toHaveBeenCalled());
      await act(async () => resolveIds({ data: { watchedProgramIds: ['program-b'] } }));

      expect(screen.getByRole('button', { name: 'Saved program program-a' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Saved program program-b' })).toBeTruthy();
    });

    it('says so when the watched list could not be loaded', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      mockedAxios.get.mockImplementation((url: string) =>
        url === '/users/watchedProgramIds'
          ? Promise.reject(new Error('network'))
          : Promise.resolve({ data: {} }),
      );
      renderPage(twoPrograms());

      expect(await screen.findByText(/could not load the programs you are watching/i)).toBeTruthy();
    });

    it('watching a program from /programs records a research_save', async () => {
      localStorage.setItem('yale-research.firstSave.program.v1', 'true');
      mockedAxios.put.mockResolvedValue({ data: {} });
      renderPage([baseFellowship({ id: 'program-a', title: 'Synthetic Program A' })]);

      await userEvent.click(await screen.findByRole('button', { name: 'Save program program-a' }));
      await waitFor(() => expect(mockedAxios.put).toHaveBeenCalled());

      await waitFor(() =>
        expect(trackResearchEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            eventType: 'research_save',
            entityType: 'fellowship',
            entityId: 'program-a',
            payload: { operation: 'save', surface: 'search' },
          }),
        ),
      );
    });

    it('offers an undo after unwatching that restores the note and stage', async () => {
      mockedAxios.get.mockImplementation((url: string) => {
        if (url === '/users/watchedProgramIds') {
          return Promise.resolve({ data: { watchedProgramIds: ['program-a'] } });
        }
        if (url === '/users/watchedProgramPlans') {
          return Promise.resolve({
            data: {
              watchedProgramPlans: {
                'program-a': { privateNotes: 'Synthetic note', stage: 'APPLIED' },
              },
            },
          });
        }
        return Promise.resolve({ data: {} });
      });
      mockedAxios.delete.mockResolvedValue({ data: {} });
      mockedAxios.put.mockResolvedValue({ data: {} });
      renderPage(twoPrograms());

      await userEvent.click(await screen.findByRole('button', { name: 'Saved program program-a' }));

      const undo = await screen.findByRole('button', { name: 'Undo' });
      expect(mockedAxios.delete).toHaveBeenCalledWith('/users/watchedPrograms', {
        withCredentials: true,
        data: { watchedPrograms: ['program-a'] },
      });
      expect(screen.getByRole('button', { name: 'Save program program-a' })).toBeTruthy();
      const region = undo.closest('[role="status"]');
      expect(region?.textContent).toContain('Synthetic Program A');
      expect(region?.textContent).toContain('Undo restores your note and stage too');

      await userEvent.click(undo);

      await waitFor(() =>
        expect(mockedAxios.put).toHaveBeenCalledWith('/users/watchedProgramPlans/program-a', {
          data: { plan: { privateNotes: 'Synthetic note', stage: 'APPLIED' } },
        }),
      );
      expect(screen.getByRole('button', { name: 'Saved program program-a' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    });

    it('does not unwatch when the plan to protect could not be read first', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      mockedAxios.get.mockImplementation((url: string) => {
        if (url === '/users/watchedProgramIds') {
          return Promise.resolve({ data: { watchedProgramIds: ['program-a'] } });
        }
        if (url === '/users/watchedProgramPlans') {
          return Promise.reject(new Error('network'));
        }
        return Promise.resolve({ data: {} });
      });
      renderPage(twoPrograms());

      await userEvent.click(await screen.findByRole('button', { name: 'Saved program program-a' }));

      await waitFor(() => expect(swal).toHaveBeenCalled());
      expect(mockedAxios.delete).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Saved program program-a' })).toBeTruthy();
    });
  });

  describe('program modal history', () => {
    const openProgram = () =>
      baseFellowship({
        id: 'open-1',
        title: 'Browse Opened Program',
        isAcceptingApplications: true,
        deadline: isoDaysFromNow(30),
      });

    const mockProgramDetail = (program: Fellowship) =>
      mockedAxios.get.mockImplementation((url: string) => {
        if (url === `/programs/${program.id}`) {
          return Promise.resolve({ data: { program } });
        }
        return Promise.resolve({ data: { watchedProgramIds: [] } });
      });

    const currentLocation = () => screen.getByTestId('current-location');

    it('closes a program opened from browse when the student presses Back', async () => {
      const program = openProgram();
      mockProgramDetail(program);
      renderPage([program]);

      await userEvent.click(await screen.findByRole('button', { name: 'Open program open-1' }));
      expect(await screen.findByRole('dialog', { name: 'Browse Opened Program' })).toBeTruthy();
      expect(currentLocation().textContent).toBe('/programs?program=open-1');

      await userEvent.click(screen.getByRole('button', { name: 'Browser back' }));

      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: 'Browse Opened Program' })).toBeNull(),
      );
      expect(currentLocation().textContent).toBe('/programs');
    });

    it('leaves view recording to the card when a program is opened from browse', async () => {
      mockedAxios.put.mockResolvedValue({ data: {} });
      const program = openProgram();
      mockProgramDetail(program);
      renderPage([program]);

      await userEvent.click(await screen.findByRole('button', { name: 'Open program open-1' }));
      await screen.findByRole('dialog', { name: 'Browse Opened Program' });
      await userEvent.click(screen.getByRole('button', { name: 'Browser back' }));
      await userEvent.click(screen.getByRole('button', { name: 'Browser forward' }));
      await screen.findByRole('dialog', { name: 'Browse Opened Program' });

      const addViewCalls = mockedAxios.put.mock.calls.filter((call) =>
        String(call[0]).endsWith('/addView'),
      );
      expect(addViewCalls).toHaveLength(0);
    });

    it('reopens the program when the student presses Forward after Back', async () => {
      const program = openProgram();
      mockProgramDetail(program);
      renderPage([program]);

      await userEvent.click(await screen.findByRole('button', { name: 'Open program open-1' }));
      await screen.findByRole('dialog', { name: 'Browse Opened Program' });
      await userEvent.click(screen.getByRole('button', { name: 'Browser back' }));
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: 'Browse Opened Program' })).toBeNull(),
      );

      await userEvent.click(screen.getByRole('button', { name: 'Browser forward' }));

      expect(await screen.findByRole('dialog', { name: 'Browse Opened Program' })).toBeTruthy();
    });

    it('leaves no extra history entry after opening and closing a program', async () => {
      const program = openProgram();
      mockProgramDetail(program);
      renderPage([program], {}, ['/previous', '/programs']);

      await userEvent.click(await screen.findByRole('button', { name: 'Open program open-1' }));
      const dialog = await screen.findByRole('dialog', { name: 'Browse Opened Program' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: 'Browse Opened Program' })).toBeNull(),
      );
      expect(currentLocation().textContent).toBe('/programs');

      await userEvent.click(screen.getByRole('button', { name: 'Browser back' }));

      expect(await screen.findByText('Previous page')).toBeTruthy();
    });

    it('closes a deep-linked program without adding a history entry', async () => {
      const program = baseFellowship({ id: 'f1', title: 'Deep Linked Program' });
      mockProgramDetail(program);
      renderPage([], {}, ['/previous', '/programs?program=f1']);

      const dialog = await screen.findByRole('dialog', { name: 'Deep Linked Program' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: 'Deep Linked Program' })).toBeNull(),
      );
      expect(currentLocation().textContent).toBe('/programs');

      await userEvent.click(screen.getByRole('button', { name: 'Browser back' }));

      expect(await screen.findByText('Previous page')).toBeTruthy();
    });
  });
});
