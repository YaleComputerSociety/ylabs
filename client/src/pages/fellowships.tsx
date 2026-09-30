/**
 * Programs & Fellowships browse page with search, local quick filters,
 * application-cycle empty states, and grid/list view.
 */
import { useReducer, useEffect, useContext, useMemo, useRef, useState } from 'react';
import swal from 'sweetalert';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import FellowshipModal from '../components/fellowship/FellowshipModal';
import AdminFellowshipEditModal from '../components/admin/AdminFellowshipEditModal';
import FellowshipSearchContext from '../contexts/FellowshipSearchContext';
import UserContext from '../contexts/UserContext';
import BrowseGrid from '../components/shared/BrowseGrid';
import FirstSaveCallout from '../components/shared/FirstSaveCallout';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import LoadErrorNotice from '../components/shared/LoadErrorNotice';
import UndoRemovalBanner from '../components/shared/UndoRemovalBanner';
import CombinedFilterDropdown, {
  FilterTabConfig,
} from '../components/shared/CombinedFilterDropdown';
import ActiveFilters, {
  ActiveFilterChip,
  QuickFilterDef,
} from '../components/shared/ActiveFilters';
import FellowshipSortDropdown from '../components/shared/FellowshipSortDropdown';
import ViewModeToggle from '../components/shared/ViewModeToggle';
import { BrowsableItem } from '../types/browsable';
import { Fellowship, type StudentVisibilityTier } from '../types/types';
import axios from '../utils/axios';
import { browsePageReducer, createInitialBrowsePageState } from '../reducers/browsePageReducer';
import type { FellowshipQuickFilter } from '../reducers/fellowshipSearchReducer';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';
import useDocumentTitle from '../hooks/useDocumentTitle';
import useFavorites from '../hooks/useFavorites';
import useUndoableProgramUnwatch, {
  undoRestoresSummary,
  watchedProgramPlanSnapshot,
} from '../hooks/useUndoableProgramUnwatch';
import { getFellowshipCycleStatus, type FellowshipCycleCategory } from '../utils/fellowshipCycle';
import { createFellowship } from '../utils/createFellowship';
import {
  cycleActionOrder,
  getProgramJourneyStatus,
  programKindLabel,
  entryModeLabel,
  programCategoryLabel,
  type ProgramJourneyCategory,
  type ProgramJourneySummary,
} from '../utils/programJourney';

const NEXT_CYCLE_FILTER_CATEGORIES: FellowshipCycleCategory[] = [
  'nextCycle',
  'projectedNextCycle',
  'openingSoon',
];

const FIRST_PROGRAM_SAVE_KEY = 'yale-research.firstSave.program.v1';

const SectionHeader = ({
  headingId,
  title,
  count,
  description,
}: {
  headingId?: string;
  title: string;
  count: number;
  description?: string;
}) => (
  <div className="mb-4 mt-10 border-t border-[var(--yr-line)] pt-5 first:mt-0 first:border-t-0 first:pt-0">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id={headingId} className="yr-display text-2xl font-semibold text-ink">
        {title}
      </h2>
      <span className="yr-pill yr-pill-blue yr-pill-compact px-2.5 py-1">{count}</span>
    </div>
    {description && <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">{description}</p>}
  </div>
);

const QuickFilterEmptyState = ({
  quickFilter,
  nextCycleCount,
  onViewNextCycle,
  onClearFilter,
}: {
  quickFilter: FellowshipQuickFilter;
  nextCycleCount: number;
  onViewNextCycle: () => void;
  onClearFilter: () => void;
}) => {
  if (quickFilter !== 'open' && quickFilter !== 'closingSoon') return null;

  const copy =
    quickFilter === 'open'
      ? {
          title: 'No application windows are open right now',
          body: 'There are no current program or fellowship applications in this filtered set. Use Next Cycle to track recurring opportunities while you prepare eligibility, mentor fit, and materials.',
        }
      : {
          title: 'No application windows are closing soon',
          body: 'There are no open program or fellowship deadlines due in the next 30 days. Use Next Cycle to track recurring opportunities while you prepare eligibility, mentor fit, and materials.',
        };

  return (
    <div className="yr-card rounded-card px-6 py-10 text-center text-muted">
      <h2 className="text-lg font-semibold text-ink">{copy.title}</h2>
      <p className="mx-auto mt-2 max-w-2xl text-sm leading-6">{copy.body}</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {nextCycleCount > 0 && (
          <button
            type="button"
            onClick={onViewNextCycle}
            className="inline-flex min-h-[44px] items-center justify-center rounded-card border border-line-brand bg-brand-soft px-4 text-sm font-semibold text-brand transition-colors hover:bg-panel yr-focus-ring"
          >
            View Next Cycle
          </button>
        )}
        <button
          type="button"
          onClick={onClearFilter}
          className="inline-flex min-h-[44px] items-center justify-center rounded-card border border-[var(--yr-line)] bg-[var(--yr-panel)] px-4 text-sm font-semibold text-ink-soft transition-colors hover:border-[var(--yr-line-strong)] hover:bg-[var(--yr-panel-muted)] yr-focus-ring"
        >
          Clear filter
        </button>
      </div>
    </div>
  );
};

const STATUS_SUMMARY_COLUMNS: Record<number, string> = {
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
};

const StatusSummary = ({ summary }: { summary: ProgramJourneySummary }) => {
  const tiles = journeySections.filter(
    (section) => section.key !== 'archive' || summary.archive > 0,
  );
  return (
    <dl
      className={`grid grid-cols-2 gap-px overflow-hidden rounded-card border border-[var(--yr-line)] bg-[var(--yr-line)] ${STATUS_SUMMARY_COLUMNS[tiles.length] ?? 'lg:grid-cols-4'}`}
    >
      {tiles.map((section) => (
        <div
          key={section.key}
          className={`bg-[var(--yr-panel)] px-4 py-3 ${section.tileClassName} ${tiles.length % 2 === 1 && section === tiles[tiles.length - 1] ? 'col-span-2 lg:col-span-1' : ''}`}
        >
          <dt className="yr-kicker text-[0.68rem]">{section.tileLabel}</dt>
          <dd className="mt-2 flex min-h-[3rem] flex-col justify-end gap-1">
            <span className="yr-num text-2xl font-semibold text-ink">{summary[section.key]}</span>
            <span className="text-xs font-medium leading-tight text-muted">
              {section.tileDetail}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
};

const fellowshipQuickFilters: QuickFilterDef[] = [
  { label: 'Open Only', value: 'open' },
  { label: 'Closing Soon', value: 'closingSoon' },
  { label: 'Get Started', value: 'structured' },
  { label: 'Mentor First', value: 'mentorFirst' },
  { label: 'Next Cycle', value: 'nextCycle' },
];

const trustTierFilterOptions: Array<{ value: StudentVisibilityTier; label: string }> = [
  { value: 'student_ready', label: 'Ready' },
  { value: 'limited_but_safe', label: 'Limited' },
  { value: 'operator_review', label: 'Review' },
  { value: 'suppressed', label: 'Suppressed' },
];

const journeySections: Array<{
  key: ProgramJourneyCategory;
  title: string;
  description: string;
  tileLabel: string;
  tileDetail: string;
  tileClassName: string;
}> = [
  {
    key: 'startsResearch',
    title: 'Get Started in Research',
    description:
      'Programs, internships, RA roles, mentor matching, and department guides that help you find a lab or a mentor. Most need no mentor before you start.',
    tileLabel: 'Get started',
    tileDetail: 'No mentor needed yet',
    tileClassName: 'yr-pill-green',
  },
  {
    key: 'fundsResearch',
    title: "Funding for Research You've Arranged",
    description:
      'Grants and fellowships that usually need a mentor, a project, or a research plan before you apply.',
    tileLabel: 'Funding',
    tileDetail: 'Need a mentor or plan first',
    tileClassName: 'yr-pill-blue',
  },
  {
    key: 'recognizesResearch',
    title: "Awards for Research You've Done",
    description:
      'Competitive awards and scholarships for students who already have a research record.',
    tileLabel: 'Awards',
    tileDetail: 'For research already done',
    tileClassName: '',
  },
  {
    key: 'archive',
    title: 'Archive / Review',
    description:
      'Retained records that need eligibility review or should not be treated as active undergraduate options.',
    tileLabel: 'Archive / review',
    tileDetail: 'Needs review; not active',
    tileClassName: '',
  },
];

const dateValue = (value?: string | null) => {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
};

const sortFellowshipsForDisplay = (
  fellowships: Fellowship[],
  sortBy: string,
  sortDirection: 'asc' | 'desc',
): Fellowship[] => {
  const sorted = [...fellowships];
  const direction = sortDirection === 'asc' ? 1 : -1;

  if (sortBy === 'deadline') {
    return sorted.sort((a, b) => {
      const da = dateValue(a.deadline);
      const db = dateValue(b.deadline);
      if (da === null && db === null) return 0;
      if (da === null) return 1;
      if (db === null) return -1;
      return (da - db) * direction;
    });
  }

  if (sortBy === 'title') {
    return sorted.sort((a, b) => a.title.localeCompare(b.title) * direction);
  }

  return sorted;
};

const PROGRAM_PARAM = 'program';
const LEGACY_PROGRAM_PARAM = 'fellowship';

interface ProgramModalHistoryState {
  programModalOpenedInPage: true;
}

const OPENED_IN_PAGE_HISTORY_STATE: ProgramModalHistoryState = { programModalOpenedInPage: true };

const wasProgramModalOpenedInPage = (historyState: unknown) =>
  (historyState as Partial<ProgramModalHistoryState> | null)?.programModalOpenedInPage === true;

const withoutProgramParams = (params: URLSearchParams) => {
  params.delete(PROGRAM_PARAM);
  params.delete(LEGACY_PROGRAM_PARAM);
  return params;
};

const Fellowships = () => {
  useDocumentTitle('Programs & Fellowships');
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const requestedProgramId =
    searchParams.get(PROGRAM_PARAM) || searchParams.get(LEGACY_PROGRAM_PARAM);
  const {
    queryString,
    fellowships,
    isLoading,
    loadError,
    setQueryString,
    filterOptions,
    selectedProgramCategory,
    setSelectedProgramCategory,
    selectedProgramKind,
    setSelectedProgramKind,
    selectedEntryMode,
    setSelectedEntryMode,
    selectedStudentFacingCategory,
    setSelectedStudentFacingCategory,
    selectedYearOfStudy,
    setSelectedYearOfStudy,
    selectedTermOfAward,
    setSelectedTermOfAward,
    selectedPurpose,
    setSelectedPurpose,
    selectedSubjects = [],
    setSelectedSubjects = () => {},
    selectedRegions,
    setSelectedRegions,
    selectedCitizenship,
    setSelectedCitizenship,
    selectedStudentVisibilityTier,
    setSelectedStudentVisibilityTier,
    sortBy,
    sortDirection,
    quickFilter,
    setQuickFilter,
    resetProgramFilters,
    refreshFellowships,
    setPage,
    searchExhausted,
    total,
    journeySummary,
    setFilterBarHeight,
  } = useContext(FellowshipSearchContext);

  const { user } = useContext(UserContext);
  const isAdmin = user?.isAdmin ?? false;

  const [state, dispatch] = useReducer(
    browsePageReducer<Fellowship>,
    undefined as unknown as never,
    () => createInitialBrowsePageState<Fellowship>(),
  );
  const [showFirstSaveCallout, setShowFirstSaveCallout] = useState(false);
  const {
    favIds: favFellowshipIds,
    loadError: watchedProgramsLoadFailed,
    setFavorite,
    reloadFavorites,
  } = useFavorites('watchedPrograms', { surface: 'search' });
  const { unwatchedProgram, unwatchProgram, undoUnwatch, restartUndoWindow } =
    useUndoableProgramUnwatch({ setFavorite, surface: 'search' });
  const capturingPlanIdsRef = useRef(new Set<string>());
  const {
    selectedItem: selectedFellowship,
    isDetailModalOpen: isModalOpen,
    adminEditItem: adminEditFellowship,
  } = state;

  useEffect(() => {
    setQueryString('');
  }, [setQueryString]);

  useEffect(() => {
    if (!isModalOpen) restartUndoWindow();
  }, [isModalOpen, restartUndoWindow]);

  const selectedProgramId = selectedFellowship?.id ?? null;

  useEffect(() => {
    if (!requestedProgramId) {
      if (isModalOpen) {
        dispatch({ type: 'CLOSE_DETAIL_MODAL' });
      }
      return;
    }
    if (isModalOpen && requestedProgramId === selectedProgramId) return;

    const openedInPage = wasProgramModalOpenedInPage(location.state);
    let isLatestRequest = true;
    axios
      .get(`/programs/${encodeURIComponent(requestedProgramId)}`)
      .then((response) => {
        if (!isLatestRequest) return;
        const rawProgram = response.data?.program || response.data?.fellowship;
        if (rawProgram) {
          const program = createFellowship(rawProgram);
          dispatch({ type: 'OPEN_DETAIL_MODAL', item: program });
          if (!openedInPage) {
            axios.put(`fellowships/${program.id}/addView`).catch(() => {});
          }
        }
      })
      .catch(() => {
        if (!isLatestRequest) return;
        console.error('Error fetching direct fellowship link.');
        setSearchParams(withoutProgramParams, { replace: true });
      });
    return () => {
      isLatestRequest = false;
    };
  }, [requestedProgramId, selectedProgramId, isModalOpen, setSearchParams, location.state]);

  const closeProgramModal = () => {
    if (wasProgramModalOpenedInPage(location.state)) {
      void navigate(-1);
      return;
    }
    setSearchParams(withoutProgramParams, { replace: true });
  };

  const fellowshipFilterTabs: FilterTabConfig[] = [
    {
      key: 'studentFacingCategory',
      label: 'Journey',
      options: filterOptions.studentFacingCategory,
      selected: selectedStudentFacingCategory,
      setSelected: setSelectedStudentFacingCategory,
    },
    {
      key: 'programKind',
      label: 'Program Kind',
      options: filterOptions.programKind,
      labelFn: programKindLabel,
      selected: selectedProgramKind,
      setSelected: setSelectedProgramKind,
    },
    {
      key: 'entryMode',
      label: 'Entry Mode',
      options: filterOptions.entryMode,
      labelFn: entryModeLabel,
      selected: selectedEntryMode,
      setSelected: setSelectedEntryMode,
    },
    {
      key: 'programCategory',
      label: 'Legacy Type',
      options: filterOptions.programCategory,
      labelFn: programCategoryLabel,
      selected: selectedProgramCategory,
      setSelected: setSelectedProgramCategory,
    },
    {
      key: 'year',
      label: 'Year',
      options: filterOptions.yearOfStudy,
      selected: selectedYearOfStudy,
      setSelected: setSelectedYearOfStudy,
    },
    {
      key: 'term',
      label: 'Term',
      options: filterOptions.termOfAward,
      selected: selectedTermOfAward,
      setSelected: setSelectedTermOfAward,
    },
    {
      key: 'subjects',
      label: 'Subject',
      options: filterOptions.subjects || [],
      selected: selectedSubjects,
      setSelected: setSelectedSubjects,
    },
    {
      key: 'purpose',
      label: 'Purpose',
      options: filterOptions.purpose,
      selected: selectedPurpose,
      setSelected: setSelectedPurpose,
    },
    {
      key: 'region',
      label: 'Region',
      options: filterOptions.globalRegions,
      selected: selectedRegions,
      setSelected: setSelectedRegions,
    },
    {
      key: 'citizenship',
      label: 'Citizenship',
      options: filterOptions.citizenshipStatus,
      selected: selectedCitizenship,
      setSelected: setSelectedCitizenship,
    },
  ];

  const fellowshipFilterGroups: {
    label: string;
    values: string[];
    labelFn?: (item: string) => string;
    clear: () => void;
  }[] = [
    {
      label: 'Journey',
      values: selectedStudentFacingCategory,
      clear: () => setSelectedStudentFacingCategory([]),
    },
    {
      label: 'Program Kind',
      values: selectedProgramKind,
      labelFn: programKindLabel,
      clear: () => setSelectedProgramKind([]),
    },
    {
      label: 'Entry Mode',
      values: selectedEntryMode,
      labelFn: entryModeLabel,
      clear: () => setSelectedEntryMode([]),
    },
    {
      label: 'Legacy Type',
      values: selectedProgramCategory,
      labelFn: programCategoryLabel,
      clear: () => setSelectedProgramCategory([]),
    },
    { label: 'Year', values: selectedYearOfStudy, clear: () => setSelectedYearOfStudy([]) },
    { label: 'Term', values: selectedTermOfAward, clear: () => setSelectedTermOfAward([]) },
    { label: 'Purpose', values: selectedPurpose, clear: () => setSelectedPurpose([]) },
    { label: 'Subject', values: selectedSubjects, clear: () => setSelectedSubjects([]) },
    { label: 'Region', values: selectedRegions, clear: () => setSelectedRegions([]) },
    { label: 'Citizenship', values: selectedCitizenship, clear: () => setSelectedCitizenship([]) },
  ].filter((g) => g.values.length > 0);

  const fellowshipChips: ActiveFilterChip[] = fellowshipFilterGroups.map((group) => {
    const displayValues = group.labelFn ? group.values.map(group.labelFn) : group.values;
    const display =
      displayValues.length <= 3
        ? displayValues.join(', ')
        : `${displayValues.slice(0, 2).join(', ')} +${displayValues.length - 2} more`;
    return {
      key: `f-${group.label}`,
      label: `${group.label}: ${display}`,
      colorClass: 'bg-[var(--yr-panel-muted)] text-ink-soft border border-[var(--yr-line-strong)]',
      onRemove: group.clear,
    };
  });

  const { closingSoon, open, nextCycleFilterCount, journeyGroups, cycleOf } = useMemo(() => {
    const now = new Date();
    const cycleGroups = {
      closingSoon: [] as Fellowship[],
      open: [] as Fellowship[],
      openingSoon: [] as Fellowship[],
      projectedNextCycle: [] as Fellowship[],
      nextCycle: [] as Fellowship[],
      closed: [] as Fellowship[],
    };
    const groups: Record<ProgramJourneyCategory, Fellowship[]> = {
      startsResearch: [],
      fundsResearch: [],
      recognizesResearch: [],
      archive: [],
    };
    const cycleOf = new Map<Fellowship, FellowshipCycleCategory>();
    for (const f of fellowships) {
      const cycleCat = getFellowshipCycleStatus(f, now).category;
      cycleOf.set(f, cycleCat);
      cycleGroups[cycleCat].push(f);
      groups[getProgramJourneyStatus(f).category].push(f);
    }
    cycleGroups.closingSoon.sort((a, b) => {
      const da = a.deadline ? new Date(a.deadline).getTime() : Infinity;
      const db = b.deadline ? new Date(b.deadline).getTime() : Infinity;
      return da - db;
    });
    if (sortBy !== 'default') {
      cycleGroups.closingSoon = sortFellowshipsForDisplay(
        cycleGroups.closingSoon,
        sortBy,
        sortDirection,
      );
      cycleGroups.open = sortFellowshipsForDisplay(cycleGroups.open, sortBy, sortDirection);
      cycleGroups.openingSoon = sortFellowshipsForDisplay(
        cycleGroups.openingSoon,
        sortBy,
        sortDirection,
      );
      cycleGroups.projectedNextCycle = sortFellowshipsForDisplay(
        cycleGroups.projectedNextCycle,
        sortBy,
        sortDirection,
      );
      cycleGroups.nextCycle = sortFellowshipsForDisplay(
        cycleGroups.nextCycle,
        sortBy,
        sortDirection,
      );
      cycleGroups.closed = sortFellowshipsForDisplay(cycleGroups.closed, sortBy, sortDirection);
      for (const key of Object.keys(groups) as ProgramJourneyCategory[]) {
        groups[key] = sortFellowshipsForDisplay(groups[key], sortBy, sortDirection);
      }
    } else {
      for (const key of Object.keys(groups) as ProgramJourneyCategory[]) {
        groups[key].sort((a, b) => {
          const byAction = cycleActionOrder(cycleOf.get(a)!) - cycleActionOrder(cycleOf.get(b)!);
          if (byAction !== 0) return byAction;
          const da = dateValue(a.deadline) ?? Number.MAX_SAFE_INTEGER;
          const db = dateValue(b.deadline) ?? Number.MAX_SAFE_INTEGER;
          return da - db;
        });
      }
    }
    const nextCycleFilterCount = NEXT_CYCLE_FILTER_CATEGORIES.reduce(
      (count, category) => count + cycleGroups[category].length,
      0,
    );
    return { ...cycleGroups, nextCycleFilterCount, journeyGroups: groups, cycleOf };
  }, [fellowships, sortBy, sortDirection]);

  const toBrowsable = (fs: Fellowship[]): BrowsableItem[] =>
    fs.map((f) => ({ type: 'fellowship' as const, data: f }));

  const journeyItems = useMemo(() => {
    const byKey = {} as Record<ProgramJourneyCategory, BrowsableItem[]>;
    for (const key of Object.keys(journeyGroups) as ProgramJourneyCategory[]) {
      let rows = journeyGroups[key];
      if (quickFilter === 'open') {
        rows = rows.filter((f) => ['open', 'closingSoon'].includes(cycleOf.get(f)!));
      }
      if (quickFilter === 'closingSoon') {
        rows = rows.filter((f) => cycleOf.get(f) === 'closingSoon');
      }
      if (quickFilter === 'nextCycle') {
        rows = rows.filter((f) => NEXT_CYCLE_FILTER_CATEGORIES.includes(cycleOf.get(f)!));
      }
      if (quickFilter === 'mentorFirst') {
        rows = rows.filter((f) => f.requiresMentorBeforeApply);
      }
      byKey[key] = toBrowsable(rows);
    }
    return byKey;
  }, [journeyGroups, cycleOf, quickFilter]);

  const showSection = (section: ProgramJourneyCategory) => {
    if (quickFilter === 'structured') return section === 'startsResearch';
    if (quickFilter === 'mentorFirst') return section === 'fundsResearch';
    return true;
  };

  const watchProgram = (programId: string) => {
    if (!localStorage.getItem(FIRST_PROGRAM_SAVE_KEY)) {
      localStorage.setItem(FIRST_PROGRAM_SAVE_KEY, 'true');
      setShowFirstSaveCallout(true);
    }
    void setFavorite(programId, true);
  };

  const stopWatchingProgram = async (program: { id: string; title: string }) => {
    const capturing = capturingPlanIdsRef.current;
    if (capturing.has(program.id)) return;
    capturing.add(program.id);
    try {
      const response = await axios.get('/users/watchedProgramPlans', { withCredentials: true });
      const plan = response.data?.watchedProgramPlans?.[program.id];
      void unwatchProgram(program, watchedProgramPlanSnapshot(plan));
    } catch {
      console.error('Error reading watched program plan before unwatching.');
      void swal({
        text: 'Could not stop watching this program. Check your connection and try again.',
        icon: 'warning',
      });
    } finally {
      capturing.delete(program.id);
    }
  };

  const toggleWatch = (program: { id: string; title: string }) => {
    if (favFellowshipIds.includes(program.id)) void stopWatchingProgram(program);
    else watchProgram(program.id);
  };

  const handleToggleFavorite = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const program = fellowships.find((fellowship) => fellowship.id === id);
    toggleWatch({ id, title: program?.title ?? 'this program' });
  };

  const handleOpenModal = (item: BrowsableItem) => {
    if (item.type === 'fellowship') {
      dispatch({ type: 'OPEN_DETAIL_MODAL', item: item.data });
      setSearchParams(
        (params) => {
          params.delete(LEGACY_PROGRAM_PARAM);
          params.set(PROGRAM_PARAM, item.data.id);
          return params;
        },
        { state: OPENED_IN_PAGE_HISTORY_STATE },
      );
    }
  };

  const handleAdminEdit = (item: BrowsableItem) => {
    if (item.type === 'fellowship') {
      dispatch({ type: 'OPEN_ADMIN_EDIT', item: item.data });
    }
  };

  const noResults = fellowships.length === 0 && !isLoading;
  const toggleTrustTierFilter = (tier: StudentVisibilityTier) => {
    setSelectedStudentVisibilityTier((current) =>
      current.includes(tier) ? current.filter((value) => value !== tier) : [...current, tier],
    );
  };
  const activeResultCount = journeySections.reduce(
    (count, section) =>
      showSection(section.key) ? count + journeyItems[section.key].length : count,
    0,
  );
  const resultCounterCount = quickFilter ? activeResultCount : total;
  const sectionCount = (key: ProgramJourneyCategory): number =>
    quickFilter ? journeyItems[key].length : journeySummary[key];
  const showQuickFilterEmptyState =
    !isLoading &&
    searchExhausted &&
    activeResultCount === 0 &&
    (quickFilter === 'open' || quickFilter === 'closingSoon') &&
    fellowships.length > 0;
  const hasActiveStructuredFilter =
    selectedProgramCategory.length > 0 ||
    selectedProgramKind.length > 0 ||
    selectedEntryMode.length > 0 ||
    selectedStudentFacingCategory.length > 0 ||
    selectedYearOfStudy.length > 0 ||
    selectedTermOfAward.length > 0 ||
    selectedPurpose.length > 0 ||
    selectedSubjects.length > 0 ||
    selectedRegions.length > 0 ||
    selectedCitizenship.length > 0 ||
    selectedStudentVisibilityTier.length > 0;
  const showNoLiveWindowsNotice =
    !isLoading &&
    searchExhausted &&
    !quickFilter &&
    !queryString.trim() &&
    !hasActiveStructuredFilter &&
    fellowships.length > 0 &&
    open.length === 0 &&
    closingSoon.length === 0;

  const sentinelRef = useInfiniteScroll({
    searchExhausted,
    isLoading,
    setPage,
    filteredCount: activeResultCount,
    totalRawCount: fellowships.length,
    quickFilterActive: !!quickFilter,
  });

  const handleLoadMore = () => {
    if (!isLoading && !searchExhausted) {
      setPage((prev) => prev + 1);
    }
  };

  return (
    <div className="yr-page min-h-[calc(100vh-12rem)]">
      <div className="mx-auto w-full max-w-screen-2xl px-4 pb-10 sm:px-6 lg:px-8">
        <div className="pt-8 pb-6">
          <div className="grid gap-6 border-b border-[var(--yr-line)] pb-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-end">
            <div className="max-w-3xl">
              <p className="yr-kicker">Program planning</p>
              <h1 className="yr-display mt-2 text-4xl font-semibold leading-tight text-ink sm:text-5xl">
                Programs & Fellowships
              </h1>
              <p className="mt-3 text-base leading-7 text-muted">
                Yale research programs, fellowships, and awards, grouped by what you need first.
                Some are a way into research with no mentor needed yet; others fund a project once
                you have a mentor or a plan.
              </p>
            </div>
            <div className="flex flex-col gap-2 border-l border-[var(--yr-line)] pl-0 sm:flex-row lg:flex-col lg:pl-5">
              <Link
                to="/dashboard?tab=programs"
                className="yr-pressable inline-flex min-h-[44px] items-center justify-center rounded-card border border-line-brand bg-brand-soft px-4 text-sm font-semibold text-brand transition-colors hover:bg-panel yr-focus-ring"
              >
                Saved programs
              </Link>
              <a
                href="https://yale.communityforce.com/Funds/Search.aspx#4371597136646D517975544F5976596D4E73384E69673D3D"
                target="_blank"
                rel="noopener noreferrer"
                className="yr-pressable inline-flex min-h-[44px] items-center justify-center rounded-card border border-[var(--yr-line)] bg-[var(--yr-panel)] px-4 text-sm font-semibold text-ink-soft transition-colors hover:border-[var(--yr-line-strong)] hover:bg-[var(--yr-panel-muted)] yr-focus-ring"
              >
                All Yale fellowships
              </a>
            </div>
          </div>

          {!loadError && (
            <div className="mt-5">
              <StatusSummary summary={journeySummary} />
            </div>
          )}
        </div>

        <div className="grid gap-6 xl:grid-cols-[20rem_minmax(0,1fr)] xl:items-start xl:gap-8">
          <aside className="space-y-3 xl:sticky xl:top-6">
            <div className="yr-panel flex flex-col gap-3 rounded-card p-3 sm:flex-row sm:flex-wrap sm:items-end xl:flex-col xl:items-stretch">
              <div className="min-w-0 basis-full flex-1 sm:min-w-[220px]">
                <label
                  htmlFor="program-search"
                  className="mb-1 block text-xs font-semibold text-ink-soft"
                >
                  Search programs and fellowships
                </label>
                <input
                  id="program-search"
                  type="search"
                  value={queryString}
                  onChange={(e) => setQueryString(e.target.value)}
                  placeholder="Try a topic, program, deadline, or funding source"
                  className="min-h-[44px] w-full rounded-card border border-[var(--yr-line-strong)] bg-[var(--yr-panel)] px-3 text-base text-ink-soft focus:border-transparent yr-focus-ring"
                />
              </div>
              <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto xl:flex-col xl:items-stretch">
                <FellowshipSortDropdown />
                <ViewModeToggle />
                <CombinedFilterDropdown
                  tabs={fellowshipFilterTabs}
                  mobileSheet
                  dialogLabel="Program filters"
                />
              </div>
            </div>
            <ActiveFilters
              quickFilters={fellowshipQuickFilters}
              activeQuickFilter={quickFilter}
              onQuickFilterChange={(value) => setQuickFilter(value as FellowshipQuickFilter)}
              totalCount={loadError ? undefined : resultCounterCount}
              isLoading={isLoading}
              chips={fellowshipChips}
              onClearAll={() => {
                resetProgramFilters();
                setSelectedStudentVisibilityTier([]);
              }}
              onHeightChange={setFilterBarHeight}
            />
            {isAdmin && (
              <div
                className="rounded-card border border-[var(--yr-line)] bg-[var(--yr-panel)] p-2"
                aria-label="Trust tier filters"
              >
                <div className="flex flex-wrap gap-2">
                  {trustTierFilterOptions.map((option) => {
                    const isActive = selectedStudentVisibilityTier.includes(option.value);
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={isActive}
                        onClick={() => toggleTrustTierFilter(option.value)}
                        className={`min-h-10 rounded-control border px-3 py-1.5 text-sm font-semibold transition-colors yr-focus-ring ${
                          isActive
                            ? 'border-brand bg-brand text-white'
                            : 'border-[var(--yr-line)] bg-[var(--yr-panel)] text-ink-soft hover:bg-[var(--yr-panel-muted)]'
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </aside>

          <div className="min-w-0">
            {showFirstSaveCallout && (
              <FirstSaveCallout kind="program" onDismiss={() => setShowFirstSaveCallout(false)} />
            )}

            {watchedProgramsLoadFailed && (
              <div
                role="alert"
                className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-amber-200 bg-amber-50 px-4 py-3"
              >
                <p className="text-sm text-amber-900">
                  We could not load the programs you are watching, so the bookmarks below may not
                  match your Dashboard.
                </p>
                <button
                  type="button"
                  onClick={() => void reloadFavorites()}
                  className="yr-focus-ring inline-flex min-h-[44px] flex-shrink-0 items-center rounded-control border border-amber-300 bg-panel px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                >
                  Try again
                </button>
              </div>
            )}

            {isLoading && fellowships.length === 0 ? (
              <LoadingSpinner size="lg" />
            ) : loadError ? (
              <LoadErrorNotice
                headingLevel={2}
                title="Could not load programs and fellowships"
                detail="This is a loading problem, not a sign that no programs match. Check your connection, then try again."
                onRetry={refreshFellowships}
              />
            ) : noResults ? (
              <div className="yr-card rounded-card px-6 py-10 text-center text-muted">
                <h2 className="text-lg font-semibold text-ink">No program records found</h2>
                <p className="mt-2 text-sm">
                  Try adjusting the search or checking the official Yale program and fellowship
                  source.
                </p>
              </div>
            ) : showQuickFilterEmptyState ? (
              <QuickFilterEmptyState
                quickFilter={quickFilter}
                nextCycleCount={nextCycleFilterCount}
                onViewNextCycle={() => setQuickFilter('nextCycle')}
                onClearFilter={() => setQuickFilter(null)}
              />
            ) : (
              <>
                {showNoLiveWindowsNotice && (
                  <div className="mb-6 rounded-card border border-line-brand bg-brand-soft px-5 py-4">
                    <h2 className="text-base font-semibold text-brand-navy">
                      No programs are currently accepting applications
                    </h2>
                    <p className="mt-1 max-w-3xl text-sm leading-6 text-brand-navy">
                      Every tracked program and fellowship has closed its most recent application
                      window. Use the recurring records below to plan for the next cycle: review
                      eligibility, line up a mentor, and prepare materials now so you are ready when
                      applications reopen.
                    </p>
                  </div>
                )}
                {journeySections.map((section) =>
                  showSection(section.key) && journeyItems[section.key].length > 0 ? (
                    <section key={section.key} aria-labelledby={`program-section-${section.key}`}>
                      <SectionHeader
                        headingId={`program-section-${section.key}`}
                        title={section.title}
                        count={sectionCount(section.key)}
                        description={section.description}
                      />
                      <BrowseGrid
                        items={journeyItems[section.key]}
                        favIds={favFellowshipIds}
                        onToggleFavorite={handleToggleFavorite}
                        onOpenModal={handleOpenModal}
                        onAdminEdit={isAdmin ? handleAdminEdit : undefined}
                        isLoading={isLoading}
                        emptyMessage={`No ${section.title.toLowerCase()} records`}
                        onLoadMore={handleLoadMore}
                        disableVirtualization
                      />
                    </section>
                  ) : null,
                )}

                {!searchExhausted && <div ref={sentinelRef} className="h-10 w-full mt-4" />}
              </>
            )}
          </div>
        </div>

        {unwatchedProgram && (
          <div className="fixed inset-x-4 bottom-4 z-[1100] mx-auto max-w-xl">
            <UndoRemovalBanner floating onUndo={() => void undoUnwatch()}>
              Stopped watching{' '}
              <span className="font-semibold text-ink">{unwatchedProgram.title}</span>.
              {undoRestoresSummary(unwatchedProgram.plan)}
            </UndoRemovalBanner>
          </div>
        )}

        {selectedFellowship && (
          <FellowshipModal
            fellowship={selectedFellowship}
            isOpen={isModalOpen}
            onClose={closeProgramModal}
            isFavorite={favFellowshipIds.includes(selectedFellowship.id)}
            toggleFavorite={() => toggleWatch(selectedFellowship)}
          />
        )}
      </div>

      {adminEditFellowship && (
        <AdminFellowshipEditModal
          fellowship={adminEditFellowship}
          onClose={() => dispatch({ type: 'CLOSE_ADMIN_EDIT' })}
          onSave={() => {
            dispatch({ type: 'CLOSE_ADMIN_EDIT' });
            refreshFellowships();
          }}
        />
      )}
    </div>
  );
};

export default Fellowships;
