import * as React from 'react';
import ListingsModal from '../accounts/ListingModal';
import ListingCard from './ListingCard';
import PulseLoader from "react-spinners/PulseLoader";
import { NewListing } from '../../types/types';

type Order = 'asc' | 'desc';

type ListingsCardListProps = {
  loading: Boolean;
  listings: NewListing[];
  sortableKeys: string[];
  setSortBy: (sortBy: string) => void;
  setSortOrder: (sortOrder: number) => void;
};

//Add favlistingid's
//Add favorite functionality
//Make sorting fetch a new search
//Add back in the bottom sensor

export default function ListingsCardList({ loading, listings, sortableKeys, setSortBy, setSortOrder }: ListingsCardListProps) {
  const [order, setOrder] = React.useState<Order>('asc');
  const [orderIndex, setOrderIndex] = React.useState(0);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [selectedListingId, setSelectedListingId] = React.useState<string | null>(null);

  const buttonTranslations: Record<string, string[]> = {
    'default': ['Best Match', '', ''],
    'updatedAt': ['Last Updated', 'Newest', 'Oldest'],
    'ownerLastName': ['Last Name', 'A-Z', 'Z-A'],
    'ownerFirstName': ['First Name', 'A-Z', 'Z-A'],
    'title': ['Lab Title', 'A-Z', 'Z-A']
  }

  React.useEffect(() => {
    setSortOrder(order === 'asc' ? 1 : -1);
  }, [order])

  React.useEffect(() => {
    setSortBy(sortableKeys[orderIndex]);
  }, [orderIndex])

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
        {!loading && selectedListingId !== null && (
            <ListingsModal
              listing={listings.find((l) => l.id === selectedListingId)!}
              onClose={() => {
                setModalOpen(false);
                setSelectedListingId(null);
              }}
              isOpen={modalOpen}
              favListingsIds={[]}
              updateFavorite={() => {console.log('Favorite')}}
            />
      )}

      {/* Sorting Buttons */}
      <div className="mb-4 flex justify-between w-full" style={{ maxWidth: '80%' }}>
        <button
          onClick={() => {
            if (!loading) {
              handleToggleSortKey();
            }
          }}
          className="px-4 py-2 bg-blue-500 text-white rounded"
        >
          Sort: {buttonTranslations[sortableKeys[orderIndex]][0]}
        </button>
        {sortableKeys[orderIndex] !== 'default' && (
          <button
            onClick={() => {
              if (!loading) {
                handleToggleOrder();
              }
            }}
            className="px-4 py-2 bg-blue-500 text-white rounded"
          >
            {order === 'asc' ? buttonTranslations[sortableKeys[orderIndex]][1] : buttonTranslations[sortableKeys[orderIndex]][2]}
          </button>
        )}
      </div>

      
      {/* List of Cards (Rows) or Pulse Loader */}
      {loading ? (
        <div style={{marginTop: '17%', textAlign: 'center'}}>
            <PulseLoader color="#66CCFF" size={10} /> 
        </div>
      ) : (
        <div className="w-full" style={{ maxWidth: '80%' }}>
          {listings.map((listing) => (
            <ListingCard
              key={listing.id}
              favListingsIds={[]}
              listing={listing}
              updateFavorite={() => {console.log('Favorite')}}
              openModal={openModalForListing}
            />
          ))}
        </div>
      )}

      {/* Scroll to Top Button */}
      <button
        onClick={() => {
          if (!loading) {
            scrollToTop();
          }
        }}
        className="fixed bottom-6 right-6 bg-blue-500 text-white p-3 rounded-full shadow-lg hover:bg-blue-700 transition"
      >
        ⬆️
      </button>
    </div>
  );
}