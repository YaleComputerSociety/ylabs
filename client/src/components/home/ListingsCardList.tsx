import * as React from 'react';
import ListingsModal from '../home/ListingModal';
import ListingCard from './ListingCard';
import SortDropdown from './SortDropdown';
import PulseLoader from "react-spinners/PulseLoader";
import { NewListing } from '../../types/types';

type ListingsCardListProps = {
  loading: Boolean;
  searchExhausted: Boolean;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  listings: NewListing[];
  sortableKeys: string[];
  sortBy: string;
  setSortBy: (sortBy: string) => void;
  setSortOrder: (sortOrder: number) => void;
  sortDirection: 'asc' | 'desc';
  onToggleSortDirection: () => void;
  favListingsIds: string[];
  updateFavorite: (listingId: string, favorite: boolean) => void;
};

export default function ListingsCardList({ 
  loading, 
  searchExhausted, 
  setPage, 
  listings, 
  sortableKeys, 
  sortBy, 
  setSortBy, 
  setSortOrder, 
  sortDirection,
  onToggleSortDirection,
  favListingsIds, 
  updateFavorite 
}: ListingsCardListProps) {
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

  const buttonTranslations = [
    {value: 'default', label: 'Sort by: Best Match'},
    {value: 'updatedAt', label: 'Sort by: Last Updated'},
    {value: 'ownerLastName', label: 'Sort by: Last Name'},
    {value: 'ownerFirstName', label: 'Sort by: First Name'},
    {value: 'title', label: 'Sort by: Lab Title'}
  ];

  const openModalForListing = (listing: NewListing) => {
    setSelectedListingId(listing.id);
    setModalOpen(true);
  };

  // Scroll to top button
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="flex flex-col items-center relative pb-4">
      
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

      {/* Sorting Buttons - Only visible on small screens */}
      <div className="mb-4 flex justify-between w-full md:hidden">
        <SortDropdown sortBy={sortBy} setSortBy={setSortBy} sortOptions={buttonTranslations} searchHub={false} />
        {sortBy !== 'default' && (
          <button
            onClick={() => {
              if (!loading) {
                onToggleSortDirection(); // Use the shared handler
              }
            }}
            className="p-2 flex items-center justify-center"
            aria-label={sortDirection === 'asc' ? "Sort ascending" : "Sort descending"}
          >
            <svg 
              width="20" 
              height="20" 
              viewBox="0 0 24 24" 
              fill="none" 
              xmlns="http://www.w3.org/2000/svg"
              className={`transition-transform duration-300 ease-in-out transform ${sortDirection === 'asc' ? 'rotate-0' : 'rotate-180'}`}
            >
              <path 
                d="M12 5l7 7-1.41 1.41L13 8.83V19h-2V8.83L6.41 13.41 5 12l7-7z" 
                fill="currentColor" 
              />
            </svg>
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
        className="fixed bottom-4 right-4 lg:bottom-6 lg:right-6 bg-blue-500 text-white p-0.5 rounded-full shadow-[0_3.5px_3px_rgba(0,0,0,0.3)] transition-all duration-200 z-10 group"
        aria-label="Scroll to top"
      >
        <svg 
          xmlns="http://www.w3.org/2000/svg" 
          width="35" 
          height="35" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="white" 
          strokeWidth="2" 
          strokeLinecap="round" 
          strokeLinejoin="round"
          className="transition-opacity duration-200 opacity-70 group-hover:opacity-100"
        >
          <polyline points="18 15 12 7.5 6 15"></polyline>
        </svg>
      </button>
    </div>
  );
}