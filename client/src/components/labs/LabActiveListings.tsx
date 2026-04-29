/**
 * Active listings tied to a research group.
 *
 * Reuses the shared `BrowseCard` + the `useFavorites` / `useListingModal`
 * hooks so behavior matches the home browse page exactly. Pure consumer of
 * the listings array — the parent page is responsible for fetching it.
 */
import { Listing } from '../../types/types';
import BrowseCard from '../shared/BrowseCard';
import { useFavorites } from '../../hooks/useFavorites';
import { useListingModal } from '../../hooks/useDetailModal';

interface LabActiveListingsProps {
  listings: Listing[];
}

const LabActiveListings = ({ listings }: LabActiveListingsProps) => {
  const { favIds, setFavorite } = useFavorites('listings');
  const { open: openListing, element: listingModal } = useListingModal({
    favIds,
    setFavorite,
  });

  if (!listings || listings.length === 0) {
    return (
      <p className="text-gray-500 text-sm py-8 text-center">
        No active listings from this lab right now.
      </p>
    );
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
          />
        ))}
      </div>
      {listingModal}
    </>
  );
};

export default LabActiveListings;
