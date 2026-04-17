/**
 * Main listings browse page with search, filters, and grid/list view.
 */
import { useState, useEffect, useContext, useMemo } from 'react';
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

  const { user } = useContext(UserContext);
  const isAdmin = user?.userType === 'admin';

  const [favListingsIds, setFavListingsIds] = useState<string[]>([]);
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [adminEditListing, setAdminEditListing] = useState<Listing | null>(null);

  useEffect(() => {
    setQueryString('');
  }, []);

  const reloadFavorites = async () => {
    axios
      .get('/users/favListingsIds', { withCredentials: true })
      .then((response) => {
        setFavListingsIds(response.data.favListingsIds);
      })
      .catch((error) => {
        console.error("Error fetching user's favorite listings:", error);
        setFavListingsIds([]);
        swal({ text: 'Could not load your favorite listings', icon: 'warning' });
      });
  };

  useEffect(() => {
    refreshListings();
    reloadFavorites();
  }, []);

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
    const prevFavListingsIds = favListingsIds;

    if (favorite) {
      setFavListingsIds([listingId, ...prevFavListingsIds]);
      axios
        .put('/users/favListings', { withCredentials: true, data: { favListings: [listingId] } })
        .catch((error) => {
          setFavListingsIds(prevFavListingsIds);
          console.error('Error favoriting listing:', error);
          swal({ text: 'Unable to favorite listing', icon: 'warning' });
          reloadFavorites();
        });
    } else {
      setFavListingsIds(prevFavListingsIds.filter((id) => id !== listingId));
      axios
        .delete('/users/favListings', { withCredentials: true, data: { favListings: [listingId] } })
        .catch((error) => {
          setFavListingsIds(prevFavListingsIds);
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
      setSelectedListing(item.data);
      setIsModalOpen(true);
    }
  };

  const handleAdminEdit = (item: BrowsableItem) => {
    if (item.type === 'listing') {
      setAdminEditListing(item.data);
    }
  };

  const handleNavigateToResearchArea = (area: string) => {
    setQueryString('');
    setSelectedDepartments([]);
    setSelectedResearchAreas([]);
    setSelectedListingResearchAreas([area]);
    setIsModalOpen(false);
  };

  const handleNavigateToDepartment = (dept: string) => {
    setQueryString('');
    setSelectedDepartments([dept]);
    setSelectedResearchAreas([]);
    setSelectedListingResearchAreas([]);
    setIsModalOpen(false);
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
          onClose={() => {
            setIsModalOpen(false);
            setSelectedListing(null);
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
          onClose={() => setAdminEditListing(null)}
          onSave={() => {
            setAdminEditListing(null);
            refreshListings();
          }}
        />
      )}
    </div>
  );
};

export default Home;
