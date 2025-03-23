import * as React from 'react';
import ListingsModal from './accounts/ListingModal';
import ListingCard from './accounts/ListingCard';
import { NewListing } from '../types/types';

type Order = 'asc' | 'desc';

type ListingsCardListProps = {
  listings: NewListing[];
  sortableKeys: (keyof NewListing)[];
};

export default function ListingsCardList({ listings, sortableKeys }: ListingsCardListProps) {
  const [order, setOrder] = React.useState<Order>('asc');
  const [orderIndex, setOrderIndex] = React.useState(0);
  const [sortedRows, setSortedRows] = React.useState<NewListing[]>([]);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [selectedListingId, setSelectedListingId] = React.useState<string | null>(null);

  const buttonTranslations: Record<string, string[]> = {
    'name': ['Name', 'A-Z', 'Z-A'],
    'lastUpdated': ['Date', 'Newest', 'Oldest']
  }

  /*React.useEffect(() => {
    const property = sortableKeys[orderIndex];

    // Sort the listings based on the new order
    let sortedListings;

    if(property == 'updatedAt') {
      sortedListings = [...listings].sort((a, b) =>
        order === 'asc'
          ? new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          : new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
      );
    } else {
      sortedListings = [...listings].sort((a, b) =>
        order === 'asc'
          ? a[property] > b[property] ? 1 : -1
          : a[property] < b[property] ? 1 : -1
      );
    }

    // Update states
    setSortedRows(sortedListings);
  }, [order, orderIndex, listings]);*/

  const handleToggleSortKey = () => {
    setOrderIndex((prevIndex) => (prevIndex + 1) % sortableKeys.length);
  }

  const handleToggleOrder = () => {
    setOrder((prevOrder) => prevOrder === 'asc' ? 'desc' : 'asc');
  }

  const openModalForListing = (listing: NewListing) => {
    setSelectedListingId(listing.id);
    setModalOpen(true);
  };

  // Scroll to top button
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="flex flex-col items-center p-4 relative">
      
      {/* Modal */}
      {selectedListingId !== null && (
        <ListingsModal
          listing={listings.find((l) => l.id === selectedListingId)!}
          onClose={() => {setModalOpen(false)}}
          isOpen={modalOpen}
          favListingsIds={[]}
          updateFavorite={() => {console.log('Favorite')}}
        />
      )}

      {/* Sorting Buttons */}
      <div className="mb-4 flex justify-between w-full" style={{ maxWidth: '80%' }}>
        <button
          onClick={handleToggleSortKey}
          className="px-4 py-2 bg-blue-500 text-white rounded"
        >
          Sorting by: {buttonTranslations[sortableKeys[orderIndex]][0]}
        </button>
        <button
          onClick={handleToggleOrder}
          className="px-4 py-2 bg-blue-500 text-white rounded"
        >
          {order === 'asc' ? buttonTranslations[sortableKeys[orderIndex]][1] : buttonTranslations[sortableKeys[orderIndex]][2]}
        </button>
      </div>

      {/* List of Cards (Rows) */}
      <div className="w-full" style={{ maxWidth: '80%' }}>
        {listings.map((listing) => (
          <ListingCard
            key={listing.id}
            favListingsIds={[]}
            listing={listing}
            updateFavorite={() => {console.log('Favorite')}}
            updateListing={() => {console.log('Update')}}
            postListing={() => {console.log('Post')}}
            postNewListing={() => {console.log('Post New')}}
            clearCreatedListing={() => {console.log('Clear')}}
            deleteListing={() => {console.log('Delete')}}
            openModal={openModalForListing}
            globalEditing={false}
            setGlobalEditing={() => {console.log('Set')}}
            editable={false}
            reloadListings={() => {console.log('Reload')}}
          />
        ))}
      </div>

      {/* Scroll to Top Button */}
      <button
        onClick={scrollToTop}
        className="fixed bottom-6 right-6 bg-blue-500 text-white p-3 rounded-full shadow-lg hover:bg-blue-700 transition"
      >
        ⬆️
      </button>
    </div>
  );
}
