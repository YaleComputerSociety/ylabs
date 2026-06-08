/**
 * Legacy posted roles browse page with search, filters, and grid/list view.
 */
import { useReducer, useEffect, useContext, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SearchContext from '../contexts/SearchContext';
import UserContext from '../contexts/UserContext';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';
import BrowseGrid from '../components/shared/BrowseGrid';
import ListingDetailModal from '../components/shared/ListingDetailModal';
import AdminListingEditModal from '../components/admin/AdminListingEditModal';
import { BrowsableItem } from '../types/browsable';
import { Listing } from '../types/types';
import axios from '../utils/axios';
import swal from 'sweetalert';
import { getInstitutionAffiliation } from '../utils/institutionAffiliation';
import {
  browsePageReducer,
  createInitialBrowsePageState,
} from '../reducers/browsePageReducer';
import { createListing } from '../utils/apiCleaner';

const Home = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    listings,
    isLoading,
    error: searchError,
    searchExhausted,
    setPage,
    quickFilter,
    setQuickFilter,
    refreshListings,
    setQueryString,
    setSelectedDepartments,
    setSelectedResearchAreas,
    setSelectedListingResearchAreas,
  } = useContext(SearchContext);

  const { user } = useContext(UserContext);
  const isAdmin = user?.userType === 'admin';

  const [state, dispatch] = useReducer(
    browsePageReducer<Listing>,
    undefined as unknown as never,
    () => createInitialBrowsePageState<Listing>(),
  );
  const {
    favIds: favListingsIds,
    selectedItem: selectedListing,
    isDetailModalOpen: isModalOpen,
    adminEditItem: adminEditListing,
  } = state;

  useEffect(() => {
    setQueryString('');
  }, []);

  const reloadFavorites = async () => {
    axios
      .get('/users/favListingsIds', { withCredentials: true })
      .then((response) => {
        dispatch({ type: 'SET_FAVORITES', ids: response.data.favListingsIds });
      })
      .catch((error) => {
        console.error("Error fetching user's favorite posted roles:", error);
        dispatch({ type: 'SET_FAVORITES', ids: [] });
        swal({ text: 'Could not load your favorite posted roles', icon: 'warning' });
      });
  };

  useEffect(() => {
    refreshListings();
    reloadFavorites();
  }, []);

  useEffect(() => {
    const listingId = searchParams.get('listing');
    if (listingId && !isModalOpen && !selectedListing) {
      axios
        .get(`/listings/${listingId}`, { withCredentials: true })
        .then((response) => {
          if (response.data?.listing) {
            const listing = createListing(response.data.listing);
            dispatch({ type: 'OPEN_DETAIL_MODAL', item: listing });
          }
        })
        .catch((error) => {
          console.error('Error fetching direct listing link:', error);
          setSearchParams((params) => {
            params.delete('listing');
            return params;
          });
        });
    }
  }, [searchParams, isModalOpen, selectedListing, setSearchParams]);

  const filteredListings = useMemo(() => {
    if (quickFilter === 'open') {
      return listings.filter((l) => l.hiringStatus >= 0);
    }
    if (quickFilter === 'recent') {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      return listings.filter((l) => new Date(l.createdAt) >= thirtyDaysAgo);
    }
    if (quickFilter === 'ysm') {
      return listings.filter((l) => getInstitutionAffiliation(l.departments || []) === 'YSM');
    }
    if (quickFilter === 'ysph') {
      return listings.filter((l) => getInstitutionAffiliation(l.departments || []) === 'YSPH');
    }
    if (quickFilter === 'yc') {
      return listings.filter((l) => getInstitutionAffiliation(l.departments || []) === 'YC');
    }
    return listings;
  }, [listings, quickFilter]);

  const items: BrowsableItem[] = useMemo(
    () => filteredListings.map((l) => ({ type: 'listing' as const, data: l })),
    [filteredListings],
  );
  const openListingCount = useMemo(
    () => listings.filter((l) => l.hiringStatus >= 0).length,
    [listings],
  );
  const recentListingCount = useMemo(() => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return listings.filter((l) => new Date(l.createdAt) >= thirtyDaysAgo).length;
  }, [listings]);
  const roleBoardModes = [
    { key: null, label: 'All roles', value: listings.length },
    { key: 'open', label: 'Open', value: openListingCount },
    { key: 'recent', label: 'Recent', value: recentListingCount },
    { key: 'ysm', label: 'Medicine', value: listings.filter((l) => getInstitutionAffiliation(l.departments || []) === 'YSM').length },
    { key: 'ysph', label: 'Public Health', value: listings.filter((l) => getInstitutionAffiliation(l.departments || []) === 'YSPH').length },
    { key: 'yc', label: 'Yale College', value: listings.filter((l) => getInstitutionAffiliation(l.departments || []) === 'YC').length },
  ];

  const sentinelRef = useInfiniteScroll({
    searchExhausted,
    isLoading,
    setPage,
    filteredCount: filteredListings.length,
    totalRawCount: listings.length,
    quickFilterActive: !!quickFilter,
  });

  const updateFavorite = (listingId: string, favorite: boolean) => {
    const prevFavListingsIds = favListingsIds;

    if (favorite) {
      dispatch({ type: 'SET_FAVORITES', ids: [listingId, ...prevFavListingsIds] });
      axios
        .put('/users/favListings', { withCredentials: true, data: { favListings: [listingId] } })
        .catch((error) => {
          dispatch({ type: 'SET_FAVORITES', ids: prevFavListingsIds });
          console.error('Error favoriting listing:', error);
          swal({ text: 'Unable to favorite listing', icon: 'warning' });
          reloadFavorites();
        });
    } else {
      dispatch({
        type: 'SET_FAVORITES',
        ids: prevFavListingsIds.filter((id) => id !== listingId),
      });
      axios
        .delete('/users/favListings', { withCredentials: true, data: { favListings: [listingId] } })
        .catch((error) => {
          dispatch({ type: 'SET_FAVORITES', ids: prevFavListingsIds });
          console.error('Error unfavoriting listing:', error);
          swal({ text: 'Unable to unfavorite listing', icon: 'warning' });
          reloadFavorites();
        });
    }
  };

  const handleToggleFavorite = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    updateFavorite(id, !favListingsIds.includes(id));
  };

  const handleOpenModal = (item: BrowsableItem) => {
    if (item.type === 'listing') {
      dispatch({ type: 'OPEN_DETAIL_MODAL', item: item.data });
      setSearchParams((params) => {
        params.set('listing', item.data.id);
        return params;
      });
    }
  };

  const handleAdminEdit = (item: BrowsableItem) => {
    if (item.type === 'listing') {
      dispatch({ type: 'OPEN_ADMIN_EDIT', item: item.data });
    }
  };

  const handleNavigateToResearchArea = (area: string) => {
    setQueryString('');
    setSelectedDepartments([]);
    setSelectedResearchAreas([]);
    setSelectedListingResearchAreas([area]);
    dispatch({ type: 'CLOSE_DETAIL_MODAL' });
    setSearchParams((params) => {
      params.delete('listing');
      return params;
    });
  };

  const handleNavigateToDepartment = (dept: string) => {
    setQueryString('');
    setSelectedDepartments([dept]);
    setSelectedResearchAreas([]);
    setSelectedListingResearchAreas([]);
    dispatch({ type: 'CLOSE_DETAIL_MODAL' });
    setSearchParams((params) => {
      params.delete('listing');
      return params;
    });
  };

  return (
    <div className="mx-auto max-w-[1300px] px-6 w-full min-h-[calc(100vh-12rem)]">
      <div className="mt-4 md:mt-8" />
      <section className="mb-5 rounded-lg border border-blue-100 bg-white px-4 py-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">
              Legacy board
            </p>
            <h1 className="mt-1 text-2xl font-bold text-gray-950">Posted Roles</h1>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-gray-600">
              Posted roles are now one part of Yale Research. Start with research homes
              when you want to explore what exists, then use the evidence and next steps on each profile.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/research"
              className="inline-flex min-h-11 items-center rounded-md bg-blue-700 px-3 text-sm font-semibold text-white hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              Explore research homes
            </Link>
          </div>
        </div>
      </section>
      <section
        aria-label="Posted role board controls"
        className="mb-5 rounded-lg border border-slate-200 bg-slate-950 p-3 text-white shadow-sm"
      >
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            {roleBoardModes.map((mode) => {
              const active = quickFilter === mode.key || (!quickFilter && mode.key === null);
              return (
                <button
                  key={mode.label}
                  type="button"
                  onClick={() => setQuickFilter(mode.key)}
                  className={`min-h-14 rounded-md border px-3 py-2 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-blue-300 ${
                    active
                      ? 'border-white bg-white text-slate-950'
                      : 'border-white/15 bg-white/5 text-white hover:bg-white/10'
                  }`}
                >
                  <span className="block text-[11px] font-semibold uppercase tracking-wider opacity-75">
                    {mode.label}
                  </span>
                  <span className="mt-1 block text-lg font-semibold">{mode.value}</span>
                </button>
              );
            })}
          </div>
          <div className="rounded-md border border-white/10 bg-white/5 px-3 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
              Board status
            </p>
            <p className="mt-2 text-sm leading-relaxed text-white">
              {searchError
                ? 'Posted-role search is unavailable; use Yale Research while the index is restored.'
                : `${filteredListings.length} visible role${filteredListings.length === 1 ? '' : 's'} from ${listings.length} loaded.`}
            </p>
          </div>
        </div>
      </section>
      {searchError && (
        <div
          role="status"
          className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p>{searchError}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={refreshListings}
                className="min-h-11 rounded-md border border-amber-300 bg-white px-3 text-sm font-semibold text-amber-950 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
              >
                Retry posted roles
              </button>
              <Link
                to="/research"
                className="inline-flex min-h-11 items-center rounded-md bg-amber-900 px-3 text-sm font-semibold text-white hover:bg-amber-950 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
              >
                Explore research homes
              </Link>
            </div>
          </div>
        </div>
      )}
      <BrowseGrid
        items={items}
        favIds={favListingsIds}
        onToggleFavorite={handleToggleFavorite}
        onOpenModal={handleOpenModal}
        onAdminEdit={isAdmin ? handleAdminEdit : undefined}
        sentinelRef={sentinelRef}
        isLoading={isLoading}
        searchExhausted={searchExhausted}
        quickFilter={quickFilter}
        onClearQuickFilter={() => setQuickFilter(null)}
        emptyMessage={
          searchError
            ? 'Posted-role search is unavailable. Use Yale Research for source-backed routes.'
            : 'No results match the search criteria'
        }
        onLoadMore={() => {
          if (!isLoading && !searchExhausted) {
            setPage((prev) => prev + 1);
          }
        }}
      />

      {selectedListing && (
        <ListingDetailModal
          isOpen={isModalOpen}
          onClose={() => {
            dispatch({ type: 'CLOSE_DETAIL_MODAL' });
            setSearchParams((params) => {
              params.delete('listing');
              return params;
            });
          }}
          listing={selectedListing}
          isFavorite={favListingsIds.includes(selectedListing.id)}
          onToggleFavorite={(e) => {
            e.stopPropagation();
            updateFavorite(selectedListing.id, !favListingsIds.includes(selectedListing.id));
          }}
          onNavigateToResearchArea={handleNavigateToResearchArea}
          onNavigateToDepartment={handleNavigateToDepartment}
        />
      )}

      {adminEditListing && (
        <AdminListingEditModal
          listing={{ ...adminEditListing, _id: adminEditListing.id } as any}
          onClose={() => dispatch({ type: 'CLOSE_ADMIN_EDIT' })}
          onSave={() => {
            dispatch({ type: 'CLOSE_ADMIN_EDIT' });
            refreshListings();
          }}
        />
      )}
    </div>
  );
};

export default Home;
