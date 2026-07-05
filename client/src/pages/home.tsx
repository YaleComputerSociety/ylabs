/**
 * Main listings browse page with search, filters, and grid/list view.
 */
import { useReducer, useEffect, useContext, useMemo } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import SearchContext from '../contexts/SearchContext';
import UserContext from '../contexts/UserContext';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';
import BrowseGrid from '../components/shared/BrowseGrid';
import ListingDetailModal from '../components/shared/ListingDetailModal';
import AdminListingEditModal from '../components/admin/AdminListingEditModal';
import { BrowsableItem } from '../types/browsable';
import { Listing } from '../types/types';
import axios from '../utils/axios';
import { createListing } from '../utils/apiCleaner';
import swal from 'sweetalert';
import { getInstitutionAffiliation } from '../utils/institutionAffiliation';
import { browsePageReducer, createInitialBrowsePageState } from '../reducers/browsePageReducer';

const Home = () => {
  const {
    listings,
    isLoading,
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

  const { user, isAuthenticated, isLoading: authLoading } = useContext(UserContext);
  const isAdmin = user?.userType === 'admin';
  const navigate = useNavigate();
  const location = useLocation();
  const { slug } = useParams();
  const isResearchRoute =
    location.pathname === '/research' || location.pathname.startsWith('/research/');

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

  const requireLogin = () => {
    const returnUrl = window.location.origin + location.pathname + location.search;
    localStorage.setItem('logoutReturnPath', returnUrl);
    navigate('/login');
  };

  const reloadFavorites = async () => {
    if (!isAuthenticated) {
      dispatch({ type: 'SET_FAVORITES', ids: [] });
      return;
    }

    axios
      .get('/users/favListingsIds', { withCredentials: true })
      .then((response) => {
        dispatch({ type: 'SET_FAVORITES', ids: response.data.favListingsIds });
      })
      .catch((error) => {
        console.error("Error fetching user's favorite listings:", error);
        dispatch({ type: 'SET_FAVORITES', ids: [] });
        swal({ text: 'Could not load your favorite listings', icon: 'warning' });
      });
  };

  useEffect(() => {
    refreshListings();
    if (!authLoading) {
      reloadFavorites();
    }
  }, [authLoading, isAuthenticated]);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;

    axios
      .get(`/research/${slug}`, { withCredentials: true })
      .then(async (response) => {
        if (cancelled) return;
        let listing = response.data.listing;

        if (isAuthenticated) {
          try {
            const authenticatedResponse = await axios.get(`/research/${slug}/contact`, {
              withCredentials: true,
            });
            if (cancelled) return;
            listing = authenticatedResponse.data.listing;
          } catch (error) {
            console.error('Error loading authenticated research listing details:', error);
          }
        }

        dispatch({
          type: 'OPEN_DETAIL_MODAL',
          item: createListing(listing),
        });
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Error loading research listing:', error);
        swal({ text: 'Unable to load this research listing.', icon: 'warning' });
        navigate('/research', { replace: true });
      });

    return () => {
      cancelled = true;
    };
  }, [slug, navigate, isAuthenticated]);

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

  const sentinelRef = useInfiniteScroll({
    searchExhausted,
    isLoading,
    setPage,
    filteredCount: filteredListings.length,
    totalRawCount: listings.length,
    quickFilterActive: !!quickFilter,
  });

  const updateFavorite = (listingId: string, favorite: boolean) => {
    if (!isAuthenticated) {
      requireLogin();
      return;
    }

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
      if (isResearchRoute) {
        navigate(`/research/${item.data.id}`, { replace: false });
      }
    }
  };

  const handleAdminEdit = (item: BrowsableItem) => {
    if (item.type === 'listing') {
      dispatch({ type: 'OPEN_ADMIN_EDIT', item: item.data });
    }
  };

  const closeDetailModal = () => {
    dispatch({ type: 'CLOSE_DETAIL_MODAL' });
    if (slug) {
      navigate('/research');
    }
  };

  const handleNavigateToResearchArea = (area: string) => {
    setQueryString('');
    setSelectedDepartments([]);
    setSelectedResearchAreas([]);
    setSelectedListingResearchAreas([area]);
    closeDetailModal();
  };

  const handleNavigateToDepartment = (dept: string) => {
    setQueryString('');
    setSelectedDepartments([dept]);
    setSelectedResearchAreas([]);
    setSelectedListingResearchAreas([]);
    closeDetailModal();
  };

  return (
    <div className="mx-auto max-w-[1300px] px-6 w-full min-h-[calc(100vh-12rem)]">
      <div className="mt-4 md:mt-8" />
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
        emptyMessage="No results match the search criteria"
      />

      {selectedListing && (
        <ListingDetailModal
          isOpen={isModalOpen}
          onClose={closeDetailModal}
          listing={selectedListing}
          isFavorite={favListingsIds.includes(selectedListing.id)}
          onToggleFavorite={(e) => {
            e.stopPropagation();
            updateFavorite(selectedListing.id, !favListingsIds.includes(selectedListing.id));
          }}
          onRequireAuth={requireLogin}
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
