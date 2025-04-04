import * as React from 'react';
import ListingsModal from '../home/ListingModal';
import ListingCard from './ListingCard';
import PulseLoader from "react-spinners/PulseLoader";
import { NewListing } from '../../types/types';

type Order = 'asc' | 'desc';

type ListingsCardListProps = {
  loading: Boolean;
  searchExhausted: Boolean;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  listings: NewListing[];
  sortableKeys: string[];
  setSortBy: (sortBy: string) => void;
  setSortOrder: (sortOrder: number) => void;
  favListingsIds: string[];
  updateFavorite: (listingId: string, favorite: boolean) => void;
};

export default function ListingsCardList({ loading, searchExhausted, setPage, listings, sortableKeys, setSortBy, setSortOrder, favListingsIds, updateFavorite }: ListingsCardListProps) {
  const [order, setOrder] = React.useState<Order>('asc');
  const [orderIndex, setOrderIndex] = React.useState(0);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [selectedListingId, setSelectedListingId] = React.useState<string | null>(null);

  // Reference for results bottom detector
  const bottomObserverRef = React.useRef<HTMLDivElement>(null);
  
  // Set up intersection observer for infinite scrolling
  React.useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        // If bottom element is visible, loading is false, and we haven't exhausted search results
        if (entry.isIntersecting && !loading && !searchExhausted) {
          setPage(prevPage => prevPage + 1);
        }
      },
      { threshold: 1.0 }
    );
    
    const currentObserver = bottomObserverRef.current;
    if (currentObserver) {
      observer.observe(currentObserver);
    }
    
    return () => {
      if (currentObserver) {
        observer.unobserve(currentObserver);
      }
    };
  }, [loading, searchExhausted, setPage]);

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
    <div className="flex flex-col py-4 items-center relative transition-all lg:mx-12">
      
      {/* Modal */}
        {!loading && selectedListingId !== null && (
            <ListingsModal
              listing={listings.find((l) => l.id === selectedListingId)!}
              onClose={() => {
                setModalOpen(false);
                setSelectedListingId(null);
              }}
              isOpen={modalOpen}
              favListingsIds={favListingsIds}
              updateFavorite={updateFavorite}
            />
      )}

      {/* Sorting Buttons */}
      <div className="mb-4 flex justify-between w-full">
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

      
      {/* List of Cards (Rows) with Pulse Loader conditionally below*/}
      <div className="w-full">
        {listings.map((listing) => (
          <ListingCard
            key={listing.id}
            favListingsIds={favListingsIds}
            listing={listing}
            updateFavorite={updateFavorite}
            openModal={openModalForListing}
          />
        ))}
        
        {/* Detects bottom of the list */}
        {!searchExhausted && (
          <div 
            ref={bottomObserverRef}
            className="h-10 w-full"
          />
        )}
      </div>

      {loading && (
        <div className="flex justify-center items-center mt-4">
          <PulseLoader color="#3b82f6" size={15} />
        </div>
      )}

      {/* Scroll to Top Button */}
      <button
        onClick={() => {
          if (!loading) {
            scrollToTop();
          }
        }}
        className="fixed bottom-4 right-4 lg:bottom-6 lg:right-6 bg-blue-500 text-white p-3 rounded-full shadow-lg hover:bg-blue-700 transition z-10"
      >
        ⬆️
      </button>
    </div>
  );
}