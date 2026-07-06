/**
 * Profile tab showing faculty member research listings.
 */
import { useState, useEffect } from 'react';
import { Listing } from '../../types/types';
import axios from '../../utils/axios';
import BrowseCard from '../shared/BrowseCard';

interface ProfileListingsProps {
  netid: string;
}

const ProfileListings = ({ netid }: ProfileListingsProps) => {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios
      .get(`/profiles/${netid}/listings`)
      .then((res) => {
        setListings(res.data.listings || []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
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
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {listings.map((listing) => {
        const item = { ...listing, id: listing.id || (listing as any)._id };
        return (
          <BrowseCard
            key={item.id}
            item={{ type: 'listing', data: item }}
            isFavorite={false}
            onToggleFavorite={() => {}}
            onOpenModal={() => {
              window.open(`/?listing=${item.id}`, '_blank');
            }}
          />
        );
      })}
    </div>
  );
};

export default ProfileListings;
