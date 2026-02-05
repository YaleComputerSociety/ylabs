import * as React from 'react';
import ListingsModal from '../home/ListingModal';
import ListingCard from './ListingCard';
import SortDropdown from './SortDropdown';
import PulseLoader from "react-spinners/PulseLoader";
import { Listing } from '../../types/types';
import SearchContext from '../../contexts/SearchContext';

type ListingsCardListProps = {
  loading: Boolean;
  searchExhausted: Boolean;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  listings: Listing[];
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
  sortBy,
  setSortBy,
  sortDirection,
  onToggleSortDirection,
  favListingsIds,
  updateFavorite
}: ListingsCardListProps) {
  const [modalOpen, setModalOpen] = React.useState(false);
  const [selectedListingId, setSelectedListingId] = React.useState<string | null>(null);
  const { quickFilter, setQuickFilter } = React.useContext(SearchContext);

  const bottomObserverRef = React.useRef<HTMLDivElement>(null);
  const isFetchingRef = React.useRef(false);

  // Apply quick filters
  const getFilteredListings = () => {
    let filtered = listings;

    if (quickFilter === 'open') {
      filtered = filtered.filter(l => l.hiringStatus >= 0);
    } else if (quickFilter === 'recent') {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      filtered = filtered.filter(l => new Date(l.createdAt) >= thirtyDaysAgo);
    }

    return filtered;
  };

  const filteredListings = getFilteredListings();

  // ── Robust infinite scroll ──────────────────────────────────────────────
  // Observer setup: only recreated when searchExhausted changes.
  // Uses a fetch lock ref instead of depending on `loading`, so the observer
  // stays stable and doesn't cascade re-creation on every load cycle.
  // rootMargin pre-fetches 400px before the sentinel is visible for smooth UX.
  React.useEffect(() => {
    if (searchExhausted) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isFetchingRef.current) {
          isFetchingRef.current = true;
          setPage(prev => prev + 1);
        }
      },
      { threshold: 0, rootMargin: '1000px' }
    );

    const el = bottomObserverRef.current;
    if (el) observer.observe(el);

    return () => observer.disconnect();
  }, [searchExhausted, setPage]);

  // Post-load continuation: after each fetch completes, check if the sentinel
  // is still in the loadable zone. This handles quick-filter scenarios where
  // the filtered list is short and the sentinel is immediately visible without
  // needing the observer to re-fire. Also runs when filteredListings.length
  // changes (e.g. quick filter toggled) so we start loading if needed.
  React.useEffect(() => {
    if (loading || searchExhausted) return;

    // Guard: if a quick filter is active and produces 0 results from a large
    // dataset, stop trying to load more — prevents infinite reload loops
    // (e.g. "Recently Added" when nothing was added in the last 30 days).
    if (quickFilter && filteredListings.length === 0 && listings.length >= 60) {
      return;
    }

    // Release the lock so the observer or this check can trigger the next page
    isFetchingRef.current = false;

    const el = bottomObserverRef.current;
    if (!el) return;

    // getBoundingClientRect forces a synchronous layout so the position is accurate
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight + 1000) {
      isFetchingRef.current = true;
      setPage(prev => prev + 1);
    }
  }, [loading, searchExhausted, setPage, filteredListings.length, quickFilter, listings.length]);

  const buttonTranslations = [
    {value: 'default', label: 'Sort by: Best Match'},
    {value: 'updatedAt', label: 'Sort by: Last Updated'},
    {value: 'ownerLastName', label: 'Sort by: Last Name'},
    {value: 'ownerFirstName', label: 'Sort by: First Name'},
    {value: 'title', label: 'Sort by: Lab Title'}
  ];

  const openModalForListing = (listing: Listing) => {
    setSelectedListingId(listing.id);
    setModalOpen(true);
  };

  // Only show loader when loading more (not when list is empty)
  const showLoader = loading && filteredListings.length > 0;

  return (
    <div className="flex flex-col items-center relative pb-4">
      {/* Modal */}
      {selectedListingId !== null && (
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
                onToggleSortDirection();
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

      {/* Grid of Cards */}
      <div className="w-full">
        {filteredListings.length === 0 && !loading ? (
          <div className="text-center py-8 text-gray-500">
            <p>No listings match the current filter</p>
            {quickFilter && (
              <button
                onClick={() => setQuickFilter(null)}
                className="mt-2 text-blue-600 hover:underline text-sm"
              >
                Clear filter
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredListings.map((listing) => (
              <ListingCard
                key={listing.id}
                favListingsIds={favListingsIds}
                listing={listing}
                updateFavorite={updateFavorite}
                openModal={openModalForListing}
              />
            ))}
          </div>
        )}

        {/* Sentinel for infinite scroll — always rendered when more data exists */}
        {!searchExhausted && (
          <div
            ref={bottomObserverRef}
            className="h-10 w-full"
          />
        )}
      </div>

      {showLoader && (
        <div className="flex justify-center items-center mt-4">
          <PulseLoader color="#3b82f6" size={15} />
        </div>
      )}
    </div>
  );
}
