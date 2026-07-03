import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState, type MouseEvent } from 'react';

import Fellowships from '../fellowships';
import FellowshipSearchContext, {
  FellowshipSearchContextType,
} from '../../contexts/FellowshipSearchContext';
import UserContext from '../../contexts/UserContext';
import UIContext, { defaultUIContext } from '../../contexts/UIContext';
import type { Fellowship } from '../../types/types';
import axios from '../../utils/axios';

vi.mock('../../utils/axios', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../../components/shared/BrowseGrid', () => ({
  default: ({
    items,
    favIds = [],
    onToggleFavorite,
    emptyMessage,
  }: {
    items: Array<{ data: Fellowship }>;
    favIds?: string[];
    onToggleFavorite?: (id: string, event: MouseEvent) => void;
    emptyMessage: string;
  }) => (
    <section aria-label={emptyMessage}>
      {items.map((item) => (
        <article key={item.data.id}>
          <span>{item.data.title}</span>
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
  default: () => null,
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

const renderPage = (
  fellowships: Fellowship[],
  overrides: Partial<FellowshipSearchContextType> = {},
) => {
  mockedAxios.get.mockResolvedValue({ data: { savedProgramIds: [] } });

  const value = {
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
    searchExhausted: true,
    page: 1,
    setPage: vi.fn(),
    pageSize: 500,
    total: fellowships.length,
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
    filterBarHeight: 0,
    setFilterBarHeight: vi.fn(),
    ...overrides,
  };

  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
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
            <Fellowships />
          </FellowshipSearchContext.Provider>
        </UIContext.Provider>
      </UserContext.Provider>
    </MemoryRouter>,
  );
};

const renderStatefulPage = (fellowships: Fellowship[]) => {
  mockedAxios.get.mockResolvedValue({ data: { savedProgramIds: [] } });

  const Harness = () => {
    const [sortBy, setSortBy] = useState('default');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
    const [quickFilter, setQuickFilter] = useState<string | null>(null);

    return (
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
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
                searchExhausted: true,
                page: 1,
                setPage: vi.fn(),
                pageSize: 500,
                total: fellowships.length,
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
  localStorage.clear();
});

describe('Programs page', () => {
  it('frames programs and fellowships as structured application planning with status counts', async () => {
    renderPage([
      baseFellowship({
        id: 'closing',
        title: 'Closing Soon Fellowship',
        isAcceptingApplications: true,
        deadline: '2026-05-30T00:00:00.000Z',
      }),
      baseFellowship({
        id: 'open',
        title: 'Open Fellowship',
        isAcceptingApplications: true,
        deadline: '2026-07-01T00:00:00.000Z',
      }),
      baseFellowship({
        id: 'next-cycle',
        title: 'Next Cycle Fellowship',
        programKind: 'OTHER',
        entryMode: 'UNKNOWN',
        studentFacingCategory: 'Program record',
        requiresMentorBeforeApply: false,
        isAcceptingApplications: false,
        deadline: '2026-05-01T00:00:00.000Z',
      }),
    ]);

    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith('/users/savedProgramIds');
    });

    expect(screen.getByRole('heading', { name: 'Programs & Fellowships' })).toBeTruthy();
    expect(screen.getByText(/track structured applications, recurring research programs/i)).toBeTruthy();
    expect(screen.getByText('Open now')).toBeTruthy();
    expect(screen.getByText('Closing soon')).toBeTruthy();
    expect(screen.getByText('Likely next cycle')).toBeTruthy();
    expect(screen.getByText('Planning archive')).toBeTruthy();
    expect(screen.getByText('Open Fellowship')).toBeTruthy();
    expect(screen.getByText('Next Cycle Fellowship')).toBeTruthy();
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
    await userEvent.click(screen.getByRole('option', { name: 'Senior' }));

    expect(setSelectedYearOfStudy).toHaveBeenCalled();
    const update = setSelectedYearOfStudy.mock.calls[0][0];
    expect(typeof update).toBe('function');
    expect(update([])).toEqual(['Senior']);
  });

  it('sorts visible program cards inside their cycle section from local sort controls', async () => {
    renderStatefulPage([
      baseFellowship({
        id: 'zeta',
        title: 'Zeta Open Fellowship',
        isAcceptingApplications: true,
        deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      }),
      baseFellowship({
        id: 'alpha',
        title: 'Alpha Open Fellowship',
        isAcceptingApplications: true,
        deadline: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
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
        deadline: '2026-05-30T00:00:00.000Z',
      }),
      baseFellowship({
        id: 'open',
        title: 'Open Fellowship',
        isAcceptingApplications: true,
        deadline: '2026-07-01T00:00:00.000Z',
      }),
      baseFellowship({
        id: 'next-cycle',
        title: 'Next Cycle Fellowship',
        programKind: 'OTHER',
        entryMode: 'UNKNOWN',
        studentFacingCategory: 'Program record',
        requiresMentorBeforeApply: false,
        isAcceptingApplications: false,
        deadline: '2026-05-01T00:00:00.000Z',
      }),
    ]);

    await userEvent.click(screen.getByRole('button', { name: /Next Cycle/i }));

    expect(screen.queryByText('Open Fellowship')).toBeNull();
    expect(screen.queryByText('Closing Soon Fellowship')).toBeNull();
    expect(screen.getByText('Next Cycle Fellowship')).toBeTruthy();
  });

  it('shows the first-save callout with a dashboard next step', async () => {
    mockedAxios.put.mockResolvedValue({ data: {} });
    renderPage([
      baseFellowship({
        id: 'open',
        title: 'Open Fellowship',
        isAcceptingApplications: true,
        deadline: '2026-07-01T00:00:00.000Z',
      }),
    ]);

    await userEvent.click(await screen.findByRole('button', { name: 'Save program open' }));

    expect(screen.getByText('Program saved')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Dashboard' }).getAttribute('href')).toBe(
      '/account',
    );
    expect(mockedAxios.put).toHaveBeenCalledWith('/users/savedPrograms', {
      data: { savedPrograms: ['open'] },
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
        deadline: '2026-07-01T00:00:00.000Z',
      }),
    ]);

    await userEvent.click(await screen.findByRole('button', { name: 'Save program open' }));

    expect(screen.queryByText('Program saved')).toBeNull();
  });
});
