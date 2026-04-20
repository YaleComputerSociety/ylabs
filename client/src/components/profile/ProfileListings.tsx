/**
 * Profile tab showing faculty member research listings.
 */
import { useState, useEffect, useContext } from 'react';
import { Listing } from '../../types/types';
import axios from '../../utils/axios';
import BrowseCard from '../shared/BrowseCard';
import AdminListingEditModal from '../admin/AdminListingEditModal';
import UserContext from '../../contexts/UserContext';
import { useFavorites } from '../../hooks/useFavorites';
import { useListingModal } from '../../hooks/useDetailModal';

interface ProfileListingsProps {
  netid: string;
}

const ProfileListings = ({ netid }: ProfileListingsProps) => {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [adminEditListing, setAdminEditListing] = useState<Listing | null>(null);
  const { user } = useContext(UserContext);
  const isAdmin = user?.userType === 'admin';
  const { favIds, setFavorite } = useFavorites('listings');
  const { open: openListing, element: listingModal } = useListingModal({ favIds, setFavorite });

  const reload = () => {
    setLoading(true);
    axios
      .get(`/profiles/${netid}/listings`)
      .then((res) => {
        setListings(res.data.listings || []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    reload();
  }, [netid]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (listings.length === 0) {
    return <p className="text-gray-500 text-sm py-8 text-center">No active listings.</p>;
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {listings.map((listing) => (
          <BrowseCard
            key={listing.id}
            item={{ type: 'listing', data: listing }}
            isFavorite={favIds.includes(listing.id)}
            onToggleFavorite={(e) => {
              e.stopPropagation();
              setFavorite(listing.id, !favIds.includes(listing.id));
            }}
            onOpenModal={() => openListing(listing)}
            onAdminEdit={isAdmin ? () => setAdminEditListing(listing) : undefined}
          />
        ))}
      </div>

      {listingModal}

      {adminEditListing && (
        <AdminListingEditModal
          listing={adminEditListing}
          onClose={() => setAdminEditListing(null)}
          onSave={() => {
            setAdminEditListing(null);
            reload();
          }}
        />
      )}
    </>
  );
};

export default ProfileListings;
