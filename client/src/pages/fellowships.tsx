/**
 * Fellowships browse page with search, filters, and grid/list view.
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
import CombinedFilterDropdown, { FilterTabConfig } from '../components/shared/CombinedFilterDropdown';
import ActiveFilters, {
  ActiveFilterChip,
  QuickFilterDef,
} from '../components/shared/ActiveFilters';
import FellowshipSortDropdown from '../components/shared/FellowshipSortDropdown';
import ViewModeToggle from '../components/shared/ViewModeToggle';
import { BrowsableItem } from '../types/browsable';
import { Fellowship } from '../types/types';
import axios from '../utils/axios';
import { browsePageReducer, createInitialBrowsePageState } from '../reducers/browsePageReducer';
import type { FellowshipQuickFilter } from '../reducers/fellowshipSearchReducer';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';
import useDocumentTitle from '../hooks/useDocumentTitle';
import {
  getFellowshipCycleStatus,
  type FellowshipCycleCategory,
} from '../utils/fellowshipCycle';

const FIRST_PROGRAM_SAVE_KEY = 'ylabs.firstSave.program.v1';

const SectionHeader = ({
  title,
  count,
  description,
}: {
  title: string;
  count: number;
  description?: string;
}) => (
  <div className="mb-4 mt-10 border-t border-slate-200 pt-5 first:mt-0 first:border-t-0 first:pt-0">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-xl font-semibold text-slate-950">{title}</h2>
      <span className="yr-pill yr-pill-blue min-h-0 rounded px-2.5 py-1">
        {count}
      </span>
    </div>
    {description && (
      <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">{description}</p>
    )}
  </div>
);

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
    <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-md border border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className={`bg-white px-4 py-3 ${item.className}`}
        >
          <dt className="yr-kicker text-[0.68rem]">{item.label}</dt>
          <dd className="mt-2 flex min-h-[3rem] items-end justify-between gap-3">
            <span className="text-2xl font-semibold text-slate-950">{item.value}</span>
            <span className="max-w-[8rem] text-right text-xs font-medium leading-tight text-slate-600">{item.detail}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
};

const fellowshipQuickFilters: QuickFilterDef[] = [
  { label: 'Open Only', value: 'open' },
  { label: 'Closing Soon', value: 'closingSoon' },
  { label: 'Next Cycle', value: 'nextCycle' },
  { label: 'Recently Added', value: 'recent' },
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

  if (sortBy === 'createdAt') {
    return sorted.sort((a, b) => {
      const da = dateValue(a.createdAt) ?? 0;
      const db = dateValue(b.createdAt) ?? 0;
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
    selectedYearOfStudy,
    setSelectedYearOfStudy,
    selectedTermOfAward,
    setSelectedTermOfAward,
    selectedPurpose,
    setSelectedPurpose,
    selectedRegions,
    setSelectedRegions,
    selectedCitizenship,
    setSelectedCitizenship,
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
  }, []);

  const reloadFavorites = async () => {
    axios
      .get('/users/savedProgramIds')
      .then((response) => {
        dispatch({ type: 'SET_FAVORITES', ids: response.data.savedProgramIds || [] });
      })
      .catch((error) => {
        console.error("Error fetching user's saved programs:", error);
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
        .catch((error) => {
          console.error('Error fetching direct fellowship link:', error);
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
      key: 'programCategory',
      label: 'Program Type',
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
      label: 'Program Type',
      values: selectedProgramCategory,
      clear: () => setSelectedProgramCategory([]),
    },
    { label: 'Year', values: selectedYearOfStudy, clear: () => setSelectedYearOfStudy([]) },
    { label: 'Term', values: selectedTermOfAward, clear: () => setSelectedTermOfAward([]) },
    { label: 'Purpose', values: selectedPurpose, clear: () => setSelectedPurpose([]) },
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
      colorClass: 'bg-gray-100 text-gray-700 border border-gray-300',
      onRemove: group.clear,
    };
  });

  const { closingSoon, open, nextCycle, closed } = useMemo(() => {
    const now = new Date();
    const groups = {
      closingSoon: [] as Fellowship[],
      open: [] as Fellowship[],
      nextCycle: [] as Fellowship[],
      closed: [] as Fellowship[],
    };
    for (const f of fellowships) {
      const cat = getFellowshipCycleStatus(f, now).category;
      groups[cat].push(f);
    }
    groups.closingSoon.sort((a, b) => {
      const da = a.deadline ? new Date(a.deadline).getTime() : Infinity;
      const db = b.deadline ? new Date(b.deadline).getTime() : Infinity;
      return da - db;
    });
    if (sortBy !== 'default') {
      groups.closingSoon = sortFellowshipsForDisplay(groups.closingSoon, sortBy, sortDirection);
      groups.open = sortFellowshipsForDisplay(groups.open, sortBy, sortDirection);
      groups.nextCycle = sortFellowshipsForDisplay(groups.nextCycle, sortBy, sortDirection);
      groups.closed = sortFellowshipsForDisplay(groups.closed, sortBy, sortDirection);
    }
    return groups;
  }, [fellowships, sortBy, sortDirection]);

  const toBrowsable = (fs: Fellowship[]): BrowsableItem[] =>
    fs.map((f) => ({ type: 'fellowship' as const, data: f }));

  const recentFilter = (fs: Fellowship[]) => {
    if (quickFilter !== 'recent') return fs;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return fs.filter((f) => new Date(f.createdAt) >= thirtyDaysAgo);
  };

  const closingSoonItems = useMemo(
    () => toBrowsable(recentFilter(closingSoon)),
    [closingSoon, quickFilter],
  );
  const openItems = useMemo(() => toBrowsable(recentFilter(open)), [open, quickFilter]);
  const nextCycleItems = useMemo(
    () => toBrowsable(recentFilter(nextCycle)),
    [nextCycle, quickFilter],
  );
  const closedItems = useMemo(() => toBrowsable(recentFilter(closed)), [closed, quickFilter]);

  const showSection = (section: FellowshipCycleCategory) => {
    if (quickFilter === null || quickFilter === 'recent') return true;
    if (quickFilter === 'open') return section === 'closingSoon' || section === 'open';
    if (quickFilter === 'closingSoon') return section === 'closingSoon';
    if (quickFilter === 'nextCycle') return section === 'nextCycle';
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
      axios
        .put('/users/savedPrograms', { data: { savedPrograms: [fellowshipId] } })
        .catch((error) => {
          dispatch({ type: 'SET_FAVORITES', ids: prevFavIds });
          console.error('Error saving program:', error);
        });
    } else {
      dispatch({ type: 'SET_FAVORITES', ids: prevFavIds.filter((id) => id !== fellowshipId) });
      axios
        .delete('/users/savedPrograms', { data: { savedPrograms: [fellowshipId] } })
        .catch((error) => {
          dispatch({ type: 'SET_FAVORITES', ids: prevFavIds });
          console.error('Error removing saved program:', error);
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
  const visibleCount =
    closingSoonItems.length + openItems.length + nextCycleItems.length + closedItems.length;

  const sentinelRef = useInfiniteScroll({
    searchExhausted,
    isLoading,
    setPage,
    filteredCount: visibleCount,
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
        <div className="grid gap-6 border-b border-slate-200 pb-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-end">
          <div className="max-w-3xl">
            <p className="yr-kicker">
              Program planning
            </p>
            <h1 className="mt-2 text-3xl font-semibold leading-tight text-slate-950 sm:text-4xl">
              Programs & Fellowships
            </h1>
            <p className="mt-3 text-base leading-7 text-slate-600">
              Track structured applications, recurring research programs, center internships, and
              fellowship cycles alongside your research search. Some records fund a project after
              you find a research home; others directly organize mentor matching or summer work.
            </p>
          </div>
          <div className="flex flex-col gap-2 border-l border-slate-200 pl-0 sm:flex-row lg:flex-col lg:pl-5">
            <Link
              to="/account"
              className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-blue-200 bg-[var(--yr-blue-soft)] px-4 text-sm font-semibold text-[var(--yr-blue)] transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              Saved programs
            </Link>
            <a
              href="https://yale.communityforce.com/Funds/Search.aspx#4371597136646D517975544F5976596D4E73384E69673D3D"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
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
                className="min-h-[44px] w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
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
            totalCount={total}
            isLoading={isLoading}
            chips={fellowshipChips}
            onClearAll={() => {
              setSelectedProgramCategory([]);
              setSelectedYearOfStudy([]);
              setSelectedTermOfAward([]);
              setSelectedPurpose([]);
              setSelectedRegions([]);
              setSelectedCitizenship([]);
              setQuickFilter(null);
            }}
            onHeightChange={setFilterBarHeight}
          />
        </aside>

        <div className="min-w-0">
      {showFirstSaveCallout && (
        <FirstSaveCallout
          kind="program"
          onDismiss={() => setShowFirstSaveCallout(false)}
        />
      )}

      {isLoading && fellowships.length === 0 ? (
        <LoadingSpinner size="lg" />
      ) : noResults ? (
        <div className="yr-card rounded-md px-6 py-10 text-center text-slate-600">
          <h2 className="text-lg font-semibold text-slate-950">No program records found</h2>
          <p className="mt-2 text-sm">
            Try adjusting the search or checking the official Yale program and fellowship source.
          </p>
        </div>
      ) : (
        <>
          {showSection('closingSoon') && closingSoonItems.length > 0 && (
            <>
              <SectionHeader
                title="Closing Soon"
                count={closingSoonItems.length}
                description="Deadlines close enough that eligibility and mentor fit should be checked immediately."
              />
              <BrowseGrid
                items={closingSoonItems}
                favIds={favFellowshipIds}
                onToggleFavorite={handleToggleFavorite}
                onOpenModal={handleOpenModal}
                onAdminEdit={isAdmin ? handleAdminEdit : undefined}
                isLoading={isLoading}
                emptyMessage="No closing-soon programs"
                onLoadMore={handleLoadMore}
                disableVirtualization
              />
            </>
          )}

          {showSection('open') && openItems.length > 0 && (
            <>
              <SectionHeader
                title="Open Now"
                count={openItems.length}
                description="Current application windows with deadlines that have not passed."
              />
              <BrowseGrid
                items={openItems}
                favIds={favFellowshipIds}
                onToggleFavorite={handleToggleFavorite}
                onOpenModal={handleOpenModal}
                onAdminEdit={isAdmin ? handleAdminEdit : undefined}
                isLoading={isLoading}
                emptyMessage="No open programs"
                onLoadMore={handleLoadMore}
                disableVirtualization
              />
            </>
          )}

          {showSection('nextCycle') && nextCycleItems.length > 0 && (
            <>
              <SectionHeader
                title="Likely Next Cycle"
                count={nextCycleItems.length}
                description="Official past cycles that look recurring. Treat these as planning leads until the next application window is confirmed."
              />
              <BrowseGrid
                items={nextCycleItems}
                favIds={favFellowshipIds}
                onToggleFavorite={handleToggleFavorite}
                onOpenModal={handleOpenModal}
                onAdminEdit={isAdmin ? handleAdminEdit : undefined}
                isLoading={isLoading}
                emptyMessage="No next-cycle program signals"
                onLoadMore={handleLoadMore}
                disableVirtualization
              />
            </>
          )}

          {showSection('closed') && closedItems.length > 0 && (
            <>
              <SectionHeader
                title="Planning Archive"
                count={closedItems.length}
                description="Retained records that may still inform future scraper review, but should not be treated as active opportunities."
              />
              <BrowseGrid
                items={closedItems}
                favIds={favFellowshipIds}
                onToggleFavorite={handleToggleFavorite}
                onOpenModal={handleOpenModal}
                onAdminEdit={isAdmin ? handleAdminEdit : undefined}
                isLoading={isLoading}
                emptyMessage="No closed programs"
                onLoadMore={handleLoadMore}
                disableVirtualization
              />
            </>
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
