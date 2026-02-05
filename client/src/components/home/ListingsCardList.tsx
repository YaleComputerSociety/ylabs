import * as React from 'react';
import ListingsModal from '../home/ListingModal';
import ListingCard from './ListingCard';
import SortDropdown from './SortDropdown';
import PulseLoader from "react-spinners/PulseLoader";
import { Listing } from '../../types/types';
import QuickFilters, { QuickFilterOption } from '../shared/QuickFilters';

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

// Section Header Component
const SectionHeader = ({ title, count, icon }: { title: string; count: number; icon: React.ReactNode }) => (
  <div className="flex items-center gap-2 mb-3 mt-6 first:mt-0">
    <div className="flex items-center gap-2 text-gray-700">
      {icon}
      <h2 className="text-sm font-semibold">{title}</h2>
    </div>
    <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
      {count}
    </span>
  </div>
);

// Quick filter options for listings
const listingQuickFilters: QuickFilterOption[] = [
  {
    label: 'Open Only',
    value: 'open',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
  },
  {
    label: 'Recently Added',
    value: 'recent',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    label: 'Has Prerequisites',
    value: 'prerequisites',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 3v4a1 1 0 0 0 1 1h4" />
        <path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" />
      </svg>
    ),
  },
];

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
  const [quickFilter, setQuickFilter] = React.useState<string | null>(null);

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

  const openModalForListing = (listing: Listing) => {
    setSelectedListingId(listing.id);
    setModalOpen(true);
  };

  // Apply quick filters
  const getFilteredListings = () => {
    let filtered = listings;

    if (quickFilter === 'open') {
      filtered = filtered.filter(l => l.hiringStatus >= 0);
    } else if (quickFilter === 'recent') {
      // Show listings from the last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      filtered = filtered.filter(l => new Date(l.createdAt) >= thirtyDaysAgo);
    } else if (quickFilter === 'prerequisites') {
      filtered = filtered.filter(l => l.applicantDescription && l.applicantDescription.trim() !== '');
    }

    return filtered;
  };

  const filteredListings = getFilteredListings();

  // Separate listings into open and not open (for section display)
  const openListings = filteredListings.filter(l => l.hiringStatus >= 0);
  const closedListings = filteredListings.filter(l => l.hiringStatus < 0);

  // Check if we're using a custom sort (not default/best match)
  const isCustomSort = sortBy !== 'default';

  // Don't show sections when quick filter is applied (already filtered)
  const showSections = !isCustomSort && !quickFilter;

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

      {/* Quick Filters */}
      <div className="w-full">
        <QuickFilters
          options={listingQuickFilters}
          activeFilter={quickFilter}
          onFilterChange={setQuickFilter}
        />
      </div>

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

      {/* Results count when filtered */}
      {quickFilter && (
        <div className="w-full mb-3">
          <p className="text-sm text-gray-600">
            Showing {filteredListings.length} of {listings.length} listings
          </p>
        </div>
      )}

      {/* List of Cards with Sections */}
      <div className="w-full">
        {filteredListings.length === 0 && !loading ? (
          <div className="text-center py-8 text-gray-500">
            <p>No listings match the current filter</p>
            <button
              onClick={() => setQuickFilter(null)}
              className="mt-2 text-blue-600 hover:underline text-sm"
            >
              Clear filter
            </button>
          </div>
        ) : showSections ? (
          <>
            {/* Open Positions Section */}
            {openListings.length > 0 && (
              <>
                <SectionHeader
                  title="Accepting Applications"
                  count={openListings.length}
                  icon={
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-600">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                  }
                />
                {openListings.map((listing) => (
                  <ListingCard
                    key={listing.id}
                    favListingsIds={favListingsIds}
                    listing={listing}
                    updateFavorite={updateFavorite}
                    openModal={openModalForListing}
                  />
                ))}
              </>
            )}

            {/* Not Hiring Section */}
            {closedListings.length > 0 && (
              <>
                <SectionHeader
                  title="Not Currently Hiring"
                  count={closedListings.length}
                  icon={
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                    </svg>
                  }
                />
                {closedListings.map((listing) => (
                  <ListingCard
                    key={listing.id}
                    favListingsIds={favListingsIds}
                    listing={listing}
                    updateFavorite={updateFavorite}
                    openModal={openModalForListing}
                  />
                ))}
              </>
            )}
          </>
        ) : (
          filteredListings.map((listing) => (
            <ListingCard
              key={listing.id}
              favListingsIds={favListingsIds}
              listing={listing}
              updateFavorite={updateFavorite}
              openModal={openModalForListing}
            />
          ))
        )}

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
    </div>
  );
}
