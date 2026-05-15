/**
 * Fellowships browse page with search, filters, and grid/list view.
 */
import { useReducer, useEffect, useContext, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import FellowshipModal from '../components/fellowship/FellowshipModal';
import AdminFellowshipEditModal from '../components/admin/AdminFellowshipEditModal';
import FellowshipSearchContext from '../contexts/FellowshipSearchContext';
import UserContext from '../contexts/UserContext';
import BrowseGrid from '../components/shared/BrowseGrid';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import { BrowsableItem } from '../types/browsable';
import { Fellowship } from '../types/types';
import axios from '../utils/axios';
import { browsePageReducer, createInitialBrowsePageState } from '../reducers/browsePageReducer';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';
import {
  getFellowshipCycleStatus,
  type FellowshipCycleCategory,
} from '../utils/fellowshipCycle';

const SectionHeader = ({
  title,
  count,
  color,
}: {
  title: string;
  count: number;
  color: string;
}) => (
  <div className="flex items-center gap-3 mb-4 mt-8 first:mt-0">
    <div className={`w-1 h-6 rounded-full ${color}`} />
    <h2 className="text-lg font-bold text-gray-800">{title}</h2>
    <span className="text-sm text-gray-500">({count})</span>
  </div>
);

const Fellowships = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    fellowships,
    isLoading,
    setQueryString,
    quickFilter,
    refreshFellowships,
    setPage,
    searchExhausted,
  } = useContext(FellowshipSearchContext);

  const { user } = useContext(UserContext);
  const isAdmin = user?.userType === 'admin';

  const [state, dispatch] = useReducer(
    browsePageReducer<Fellowship>,
    undefined as unknown as never,
    () => createInitialBrowsePageState<Fellowship>(),
  );
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
      .get('/users/favFellowshipIds')
      .then((response) => {
        dispatch({ type: 'SET_FAVORITES', ids: response.data.favFellowshipIds || [] });
      })
      .catch((error) => {
        console.error("Error fetching user's favorite fellowships:", error);
        dispatch({ type: 'SET_FAVORITES', ids: [] });
      });
  };

  useEffect(() => {
    reloadFavorites();
  }, []);

  useEffect(() => {
    const fellowshipId = searchParams.get('fellowship');
    if (fellowshipId && !isModalOpen && !selectedFellowship) {
      axios
        .get(`/fellowships/${fellowshipId}`)
        .then((response) => {
          if (response.data?.fellowship) {
            dispatch({ type: 'OPEN_DETAIL_MODAL', item: response.data.fellowship });
          }
        })
        .catch((error) => {
          console.error('Error fetching direct fellowship link:', error);
          setSearchParams((params) => {
            params.delete('fellowship');
            return params;
          });
        });
    }
  }, [searchParams, isModalOpen, selectedFellowship, setSearchParams]);

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
    return groups;
  }, [fellowships]);

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
      axios
        .put('/users/favFellowships', { data: { favFellowships: [fellowshipId] } })
        .catch((error) => {
          dispatch({ type: 'SET_FAVORITES', ids: prevFavIds });
          console.error('Error favoriting fellowship:', error);
        });
    } else {
      dispatch({ type: 'SET_FAVORITES', ids: prevFavIds.filter((id) => id !== fellowshipId) });
      axios
        .delete('/users/favFellowships', { data: { favFellowships: [fellowshipId] } })
        .catch((error) => {
          dispatch({ type: 'SET_FAVORITES', ids: prevFavIds });
          console.error('Error unfavoriting fellowship:', error);
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
        params.set('fellowship', item.data.id);
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

  const sentinelRef = useInfiniteScroll({
    searchExhausted,
    isLoading,
    setPage,
    filteredCount:
      closingSoonItems.length + openItems.length + nextCycleItems.length + closedItems.length,
    totalRawCount: fellowships.length,
    quickFilterActive: !!quickFilter,
  });

  const handleLoadMore = () => {
    if (!isLoading && !searchExhausted) {
      setPage((prev) => prev + 1);
    }
  };

  return (
    <div className="mx-auto max-w-[1300px] px-6 w-full min-h-[calc(100vh-12rem)]">
      <div className="mb-4 mt-6 text-center">
        <p className="text-sm text-gray-600">
          Looking for non-research fellowships?{' '}
          <a
            href="https://yale.communityforce.com/Funds/Search.aspx#4371597136646D517975544F5976596D4E73384E69673D3D"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            Search here
          </a>
          .
        </p>
      </div>

      {isLoading && fellowships.length === 0 ? (
        <LoadingSpinner size="lg" />
      ) : noResults ? (
        <div className="text-center py-8 text-gray-500">
          <p>No fellowships match the search criteria</p>
        </div>
      ) : (
        <>
          {showSection('closingSoon') && closingSoonItems.length > 0 && (
            <>
              <SectionHeader
                title="Closing Soon"
                count={closingSoonItems.length}
                color="bg-amber-500"
              />
              <BrowseGrid
                items={closingSoonItems}
                favIds={favFellowshipIds}
                onToggleFavorite={handleToggleFavorite}
                onOpenModal={handleOpenModal}
                onAdminEdit={isAdmin ? handleAdminEdit : undefined}
                isLoading={isLoading}
                emptyMessage="No closing-soon fellowships"
                onLoadMore={handleLoadMore}
                disableVirtualization
              />
            </>
          )}

          {showSection('open') && openItems.length > 0 && (
            <>
              <SectionHeader title="Open" count={openItems.length} color="bg-green-500" />
              <BrowseGrid
                items={openItems}
                favIds={favFellowshipIds}
                onToggleFavorite={handleToggleFavorite}
                onOpenModal={handleOpenModal}
                onAdminEdit={isAdmin ? handleAdminEdit : undefined}
                isLoading={isLoading}
                emptyMessage="No open fellowships"
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
                color="bg-sky-500"
              />
              <BrowseGrid
                items={nextCycleItems}
                favIds={favFellowshipIds}
                onToggleFavorite={handleToggleFavorite}
                onOpenModal={handleOpenModal}
                onAdminEdit={isAdmin ? handleAdminEdit : undefined}
                isLoading={isLoading}
                emptyMessage="No next-cycle fellowship signals"
                onLoadMore={handleLoadMore}
                disableVirtualization
              />
            </>
          )}

          {showSection('closed') && closedItems.length > 0 && (
            <>
              <SectionHeader title="Closed" count={closedItems.length} color="bg-gray-400" />
              <BrowseGrid
                items={closedItems}
                favIds={favFellowshipIds}
                onToggleFavorite={handleToggleFavorite}
                onOpenModal={handleOpenModal}
                onAdminEdit={isAdmin ? handleAdminEdit : undefined}
                isLoading={isLoading}
                emptyMessage="No closed fellowships"
                onLoadMore={handleLoadMore}
                disableVirtualization
              />
            </>
          )}

          {!searchExhausted && <div ref={sentinelRef} className="h-10 w-full mt-4" />}
        </>
      )}

      {selectedFellowship && (
        <FellowshipModal
          fellowship={selectedFellowship}
          isOpen={isModalOpen}
          onClose={() => {
            dispatch({ type: 'CLOSE_DETAIL_MODAL' });
            setSearchParams((params) => {
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
