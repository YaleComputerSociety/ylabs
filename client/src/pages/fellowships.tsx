/**
 * Programs & Fellowships browse page with search, local quick filters,
 * application-cycle empty states, and grid/list view.
 */
import { useReducer, useEffect, useContext, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import FellowshipModal from '../components/fellowship/FellowshipModal';
import AdminFellowshipEditModal from '../components/admin/AdminFellowshipEditModal';
import FellowshipSearchContext from '../contexts/FellowshipSearchContext';
import UserContext from '../contexts/UserContext';
import BrowseGrid from '../components/shared/BrowseGrid';
import FirstSaveCallout from '../components/shared/FirstSaveCallout';
import LoadingSpinner from '../components/shared/LoadingSpinner';
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
import { getFellowshipCycleStatus } from '../utils/fellowshipCycle';
import { getProgramJourneyStatus, type ProgramJourneyCategory } from '../utils/programJourney';

const FIRST_PROGRAM_SAVE_KEY = 'yale-research.firstSave.program.v1';

const SectionHeader = ({
  title,
  count,
  description,
}: {
  title: string;
  count: number;
  description?: string;
}) => (
  <div className="mb-4 mt-10 border-t border-[var(--yr-line)] pt-5 first:mt-0 first:border-t-0 first:pt-0">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-xl font-semibold text-slate-950">{title}</h2>
      <span className="yr-pill yr-pill-blue min-h-0 rounded px-2.5 py-1">{count}</span>
    </div>
    {description && (
      <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">{description}</p>
    )}
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
    <div className="yr-card rounded-md px-6 py-10 text-center text-slate-600">
      <h2 className="text-lg font-semibold text-slate-950">{copy.title}</h2>
      <p className="mx-auto mt-2 max-w-2xl text-sm leading-6">{copy.body}</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {nextCycleCount > 0 && (
          <button
            type="button"
            onClick={onViewNextCycle}
            className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-blue-200 bg-[var(--yr-blue-soft)] px-4 text-sm font-semibold text-[var(--yr-blue)] transition hover:bg-[var(--yr-panel)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            View Next Cycle
          </button>
        )}
        <button
          type="button"
          onClick={onClearFilter}
          className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] px-4 text-sm font-semibold text-slate-700 transition hover:border-[var(--yr-line-strong)] hover:bg-[var(--yr-panel-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          Clear filter
        </button>
      </div>
    </div>
  );
};

const StatusSummary = ({
  openCount,
  closingSoonCount,
  nextCycleCount,
  closedCount,
}: {
  openCount: number;
  closingSoonCount: number;
  nextCycleCount: number;
  closedCount: number;
}) => {
  const items = [
    {
      label: 'Open now',
      value: openCount + closingSoonCount,
      detail: 'Current application windows',
      className: 'yr-pill-green',
    },
    {
      label: 'Closing soon',
      value: closingSoonCount,
      detail: 'Deadlines within 30 days',
      className: 'yr-pill-gold',
    },
    {
      label: 'Likely next cycle',
      value: nextCycleCount,
      detail: 'Past official cycles worth tracking',
      className: 'yr-pill-blue',
    },
    {
      label: 'Planning archive',
      value: closedCount,
      detail: 'Inactive or lower-confidence records',
      className: '',
    },
  ];

  return (
    <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-md border border-[var(--yr-line)] bg-[var(--yr-line)] sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className={`bg-[var(--yr-panel)] px-4 py-3 ${item.className}`}>
          <dt className="yr-kicker text-[0.68rem]">{item.label}</dt>
          <dd className="mt-2 flex min-h-[3rem] items-end justify-between gap-3">
            <span className="text-2xl font-semibold text-slate-950">{item.value}</span>
            <span className="max-w-[8rem] text-right text-xs font-medium leading-tight text-slate-600">
              {item.detail}
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
  { label: 'Structured', value: 'structured' },
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
}> = [
  {
    key: 'applyNow',
    title: 'Apply Now',
    description: 'Current program, internship, project, and fellowship application windows.',
  },
  {
    key: 'openingSoon',
    title: 'Opening Soon',
    description: 'Programs and fellowships with announced future application opening dates.',
  },
  {
    key: 'structured',
    title: 'Structured Research Programs',
    description:
      'Programs, internships, RA routes, and mentor-matching experiences that organize research participation.',
  },
  {
    key: 'fundingAfterMentor',
    title: 'Funding After You Have a Mentor',
    description:
      'Funding records that usually require a research home, adviser, proposal, or lab fit first.',
  },
  {
    key: 'nextCycle',
    title: 'Plan Next Cycle',
    description:
      'Official past cycles that look recurring. Track these while preparing eligibility and mentor fit.',
  },
  {
    key: 'archive',
    title: 'Archive / Review',
    description:
      'Retained records that need eligibility review or should not be treated as active undergraduate options.',
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

const Fellowships = () => {
  useDocumentTitle('Programs & Fellowships');
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    queryString,
    fellowships,
    isLoading,
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
    refreshFellowships,
    setPage,
    searchExhausted,
    total,
    setFilterBarHeight,
  } = useContext(FellowshipSearchContext);

  const { user } = useContext(UserContext);
  const isAdmin = user?.userType === 'admin';

  const [state, dispatch] = useReducer(
    browsePageReducer<Fellowship>,
    undefined as unknown as never,
    () => createInitialBrowsePageState<Fellowship>(),
  );
  const [showFirstSaveCallout, setShowFirstSaveCallout] = useState(false);
  const {
    favIds: favFellowshipIds,
    selectedItem: selectedFellowship,
    isDetailModalOpen: isModalOpen,
    adminEditItem: adminEditFellowship,
  } = state;

  useEffect(() => {
    setQueryString('');
  }, [setQueryString]);

  const reloadFavorites = async () => {
    axios
      .get('/users/savedProgramIds')
      .then((response) => {
        dispatch({ type: 'SET_FAVORITES', ids: response.data.savedProgramIds || [] });
      })
      .catch(() => {
        console.error("Error fetching user's saved programs.");
        dispatch({ type: 'SET_FAVORITES', ids: [] });
      });
  };

  useEffect(() => {
    reloadFavorites();
  }, []);

  useEffect(() => {
    const fellowshipId = searchParams.get('program') || searchParams.get('fellowship');
    if (fellowshipId && !isModalOpen && !selectedFellowship) {
      axios
        .get(`/programs/${fellowshipId}`)
        .then((response) => {
          const program = response.data?.program || response.data?.fellowship;
          if (program) {
            dispatch({ type: 'OPEN_DETAIL_MODAL', item: program });
          }
        })
        .catch(() => {
          console.error('Error fetching direct fellowship link.');
          setSearchParams((params) => {
            params.delete('program');
            params.delete('fellowship');
            return params;
          });
        });
    }
  }, [searchParams, isModalOpen, selectedFellowship, setSearchParams]);

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
      selected: selectedProgramKind,
      setSelected: setSelectedProgramKind,
    },
    {
      key: 'entryMode',
      label: 'Entry Mode',
      options: filterOptions.entryMode,
      selected: selectedEntryMode,
      setSelected: setSelectedEntryMode,
    },
    {
      key: 'programCategory',
      label: 'Legacy Type',
      options: filterOptions.programCategory,
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

  const fellowshipFilterGroups = [
    {
      label: 'Journey',
      values: selectedStudentFacingCategory,
      clear: () => setSelectedStudentFacingCategory([]),
    },
    { label: 'Program Kind', values: selectedProgramKind, clear: () => setSelectedProgramKind([]) },
    { label: 'Entry Mode', values: selectedEntryMode, clear: () => setSelectedEntryMode([]) },
    {
      label: 'Legacy Type',
      values: selectedProgramCategory,
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
    const display =
      group.values.length <= 3
        ? group.values.join(', ')
        : `${group.values.slice(0, 2).join(', ')} +${group.values.length - 2} more`;
    return {
      key: `f-${group.label}`,
      label: `${group.label}: ${display}`,
      colorClass: 'bg-[var(--yr-panel-muted)] text-gray-700 border border-[var(--yr-line-strong)]',
      onRemove: group.clear,
    };
  });

  const { closingSoon, open, nextCycle, closed, journeyGroups } = useMemo(() => {
    const now = new Date();
    const cycleGroups = {
      closingSoon: [] as Fellowship[],
      open: [] as Fellowship[],
      openingSoon: [] as Fellowship[],
      nextCycle: [] as Fellowship[],
      closed: [] as Fellowship[],
    };
    const groups: Record<ProgramJourneyCategory, Fellowship[]> = {
      applyNow: [],
      openingSoon: [],
      structured: [],
      fundingAfterMentor: [],
      nextCycle: [],
      archive: [],
    };
    for (const f of fellowships) {
      const cycleCat = getFellowshipCycleStatus(f, now).category;
      cycleGroups[cycleCat].push(f);
      groups[getProgramJourneyStatus(f, now).category].push(f);
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
          const da = dateValue(a.deadline) ?? Number.MAX_SAFE_INTEGER;
          const db = dateValue(b.deadline) ?? Number.MAX_SAFE_INTEGER;
          return da - db;
        });
      }
    }
    return { ...cycleGroups, journeyGroups: groups };
  }, [fellowships, sortBy, sortDirection]);

  const toBrowsable = (fs: Fellowship[]): BrowsableItem[] =>
    fs.map((f) => ({ type: 'fellowship' as const, data: f }));

  const journeyItems = useMemo(() => {
    const byKey = {} as Record<ProgramJourneyCategory, BrowsableItem[]>;
    for (const key of Object.keys(journeyGroups) as ProgramJourneyCategory[]) {
      let rows = journeyGroups[key];
      if (quickFilter === 'open') {
        rows = rows.filter((f) =>
          ['open', 'closingSoon'].includes(getFellowshipCycleStatus(f).category),
        );
      }
      if (quickFilter === 'closingSoon') {
        rows = rows.filter((f) => getFellowshipCycleStatus(f).category === 'closingSoon');
      }
      if (quickFilter === 'structured') {
        rows = rows.filter((f) =>
          ['STRUCTURED_PROGRAM', 'CENTER_INTERNSHIP', 'RA_PROGRAM', 'MENTOR_MATCHING'].includes(
            f.programKind,
          ),
        );
      }
      if (quickFilter === 'mentorFirst') {
        rows = rows.filter((f) => f.requiresMentorBeforeApply);
      }
      byKey[key] = toBrowsable(rows);
    }
    return byKey;
  }, [journeyGroups, quickFilter]);

  const showSection = (section: ProgramJourneyCategory) => {
    if (quickFilter === null) return true;
    if (quickFilter === 'open') return section === 'applyNow';
    if (quickFilter === 'closingSoon') return section === 'applyNow';
    if (quickFilter === 'nextCycle') return section === 'nextCycle';
    if (quickFilter === 'structured') return section === 'structured';
    if (quickFilter === 'mentorFirst')
      return section === 'fundingAfterMentor' || section === 'applyNow';
    return false;
  };

  const updateFavorite = (fellowshipId: string, favorite: boolean) => {
    const prevFavIds = favFellowshipIds;

    if (favorite) {
      dispatch({ type: 'SET_FAVORITES', ids: [fellowshipId, ...prevFavIds] });
      if (!localStorage.getItem(FIRST_PROGRAM_SAVE_KEY)) {
        localStorage.setItem(FIRST_PROGRAM_SAVE_KEY, 'true');
        setShowFirstSaveCallout(true);
      }
      axios.put('/users/savedPrograms', { data: { savedPrograms: [fellowshipId] } }).catch(() => {
        dispatch({ type: 'SET_FAVORITES', ids: prevFavIds });
        console.error('Error saving program.');
      });
    } else {
      dispatch({ type: 'SET_FAVORITES', ids: prevFavIds.filter((id) => id !== fellowshipId) });
      axios
        .delete('/users/savedPrograms', { data: { savedPrograms: [fellowshipId] } })
        .catch(() => {
          dispatch({ type: 'SET_FAVORITES', ids: prevFavIds });
          console.error('Error removing saved program.');
        });
    }
  };

  const handleToggleFavorite = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    updateFavorite(id, !favFellowshipIds.includes(id));
  };

  const handleOpenModal = (item: BrowsableItem) => {
    if (item.type === 'fellowship') {
      dispatch({ type: 'OPEN_DETAIL_MODAL', item: item.data });
      setSearchParams((params) => {
        params.delete('fellowship');
        params.set('program', item.data.id);
        return params;
      });
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
  const showQuickFilterEmptyState =
    !isLoading &&
    searchExhausted &&
    activeResultCount === 0 &&
    (quickFilter === 'open' || quickFilter === 'closingSoon') &&
    fellowships.length > 0;

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
              <h1 className="mt-2 text-3xl font-semibold leading-tight text-slate-950 sm:text-4xl">
                Programs & Fellowships
              </h1>
              <p className="mt-3 text-base leading-7 text-slate-600">
                Track structured applications, recurring research programs, center internships, and
                fellowship cycles alongside your research search. Some records fund a project after
                you find a research home; others directly organize mentor matching or summer work.
              </p>
            </div>
            <div className="flex flex-col gap-2 border-l border-[var(--yr-line)] pl-0 sm:flex-row lg:flex-col lg:pl-5">
              <Link
                to="/account"
                className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-blue-200 bg-[var(--yr-blue-soft)] px-4 text-sm font-semibold text-[var(--yr-blue)] transition hover:bg-[var(--yr-panel)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                Saved programs
              </Link>
              <a
                href="https://yale.communityforce.com/Funds/Search.aspx#4371597136646D517975544F5976596D4E73384E69673D3D"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] px-4 text-sm font-semibold text-slate-700 transition hover:border-[var(--yr-line-strong)] hover:bg-[var(--yr-panel-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                All Yale fellowships
              </a>
            </div>
          </div>

          <div className="mt-5">
            <StatusSummary
              openCount={open.length}
              closingSoonCount={closingSoon.length}
              nextCycleCount={nextCycle.length}
              closedCount={closed.length}
            />
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[20rem_minmax(0,1fr)] xl:items-start xl:gap-8">
          <aside className="space-y-3 xl:sticky xl:top-6">
            <div className="yr-panel flex flex-col gap-3 rounded-md p-3 sm:flex-row sm:flex-wrap sm:items-end xl:flex-col xl:items-stretch">
              <div className="min-w-[220px] flex-1">
                <label
                  htmlFor="program-search"
                  className="mb-1 block text-xs font-semibold text-slate-700"
                >
                  Search programs and fellowships
                </label>
                <input
                  id="program-search"
                  type="search"
                  value={queryString}
                  onChange={(e) => setQueryString(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === 'Escape') {
                      e.preventDefault();
                      e.currentTarget.blur();
                    }
                  }}
                  placeholder="Try a topic, program, deadline, or funding source"
                  className="min-h-[44px] w-full rounded-md border border-[var(--yr-line-strong)] bg-[var(--yr-panel)] px-3 text-sm text-slate-700 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 xl:flex-col xl:items-stretch">
                <FellowshipSortDropdown />
                <ViewModeToggle />
                <CombinedFilterDropdown tabs={fellowshipFilterTabs} />
              </div>
            </div>
            <ActiveFilters
              quickFilters={fellowshipQuickFilters}
              activeQuickFilter={quickFilter}
              onQuickFilterChange={(value) => setQuickFilter(value as FellowshipQuickFilter)}
              totalCount={resultCounterCount}
              isLoading={isLoading}
              chips={fellowshipChips}
              onClearAll={() => {
                setSelectedProgramCategory([]);
                setSelectedProgramKind([]);
                setSelectedEntryMode([]);
                setSelectedStudentFacingCategory([]);
                setSelectedYearOfStudy([]);
                setSelectedTermOfAward([]);
                setSelectedPurpose([]);
                setSelectedRegions([]);
                setSelectedCitizenship([]);
                setSelectedStudentVisibilityTier([]);
                setQuickFilter(null);
              }}
              onHeightChange={setFilterBarHeight}
            />
            {isAdmin && (
              <div
                className="rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-2"
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
                        className={`min-h-10 rounded-md border px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 ${
                          isActive
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-[var(--yr-line)] bg-[var(--yr-panel)] text-slate-700 hover:bg-[var(--yr-panel-muted)]'
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

            {isLoading && fellowships.length === 0 ? (
              <LoadingSpinner size="lg" />
            ) : noResults ? (
              <div className="yr-card rounded-md px-6 py-10 text-center text-slate-600">
                <h2 className="text-lg font-semibold text-slate-950">No program records found</h2>
                <p className="mt-2 text-sm">
                  Try adjusting the search or checking the official Yale program and fellowship
                  source.
                </p>
              </div>
            ) : showQuickFilterEmptyState ? (
              <QuickFilterEmptyState
                quickFilter={quickFilter}
                nextCycleCount={journeyGroups.nextCycle.length}
                onViewNextCycle={() => setQuickFilter('nextCycle')}
                onClearFilter={() => setQuickFilter(null)}
              />
            ) : (
              <>
                {journeySections.map((section) =>
                  showSection(section.key) && journeyItems[section.key].length > 0 ? (
                    <div key={section.key}>
                      <SectionHeader
                        title={section.title}
                        count={journeyItems[section.key].length}
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
                    </div>
                  ) : null,
                )}

                {!searchExhausted && <div ref={sentinelRef} className="h-10 w-full mt-4" />}
              </>
            )}
          </div>
        </div>

        {selectedFellowship && (
          <FellowshipModal
            fellowship={selectedFellowship}
            isOpen={isModalOpen}
            onClose={() => {
              dispatch({ type: 'CLOSE_DETAIL_MODAL' });
              setSearchParams((params) => {
                params.delete('program');
                params.delete('fellowship');
                return params;
              });
            }}
            isFavorite={favFellowshipIds.includes(selectedFellowship.id)}
            toggleFavorite={() => {
              updateFavorite(
                selectedFellowship.id,
                !favFellowshipIds.includes(selectedFellowship.id),
              );
            }}
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
