import * as React from 'react';
import ListingsModal from './ListingsModal';
import { Listing } from '../types/types';

type Order = 'asc' | 'desc';

function descendingComparator<T>(a: T, b: T, orderBy: keyof T) {
  if (b[orderBy] < a[orderBy]) return -1;
  if (b[orderBy] > a[orderBy]) return 1;
  return 0;
}

function getComparator<Key extends keyof any>(
  order: Order,
  orderBy: Key
): (a: { [key in Key]: number | string }, b: { [key in Key]: number | string }) => number {
  return order === 'desc'
    ? (a, b) => descendingComparator(a, b, orderBy)
    : (a, b) => -descendingComparator(a, b, orderBy);
}

type ListingsCardListProps = {
  listings: Listing[];
};

export default function ListingsCardList({ listings }: ListingsCardListProps) {
  const [order, setOrder] = React.useState<Order>('desc');
  const [orderBy, setOrderBy] = React.useState<keyof Listing>('lastUpdated');
  const [visibleRows, setVisibleRows] = React.useState<Listing[]>([]);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [selectedListingId, setSelectedListingId] = React.useState<number | null>(null);
  const [loading, setLoading] = React.useState(false);

  const batchSize = 10; // Load 10 items at a time
  const observerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    // Initial load
    setVisibleRows(listings.slice(0, batchSize));
  }, [listings]);

  const handleRequestSort = (property: keyof Listing) => {
    setOrder((prevOrder) => {
      const isAsc = orderBy === property && prevOrder === 'asc';
      const newOrder = isAsc ? 'desc' : 'asc';
      
      // Sort the listings based on the new order
      const sortedListings = [...visibleRows].sort((a, b) =>
        newOrder === 'asc'
          ? a[property] > b[property] ? 1 : -1
          : a[property] < b[property] ? 1 : -1
      );
  
      // Update states
      setOrderBy(property);
      setVisibleRows(sortedListings);
  
      return newOrder;
    });
  };

  const openModalForListing = (listingId: number) => {
    setSelectedListingId(listingId);
    setModalOpen(true);
  };

  // Load more listings when reaching the bottom
  const loadMoreListings = React.useCallback(() => {
    if (loading || visibleRows.length >= listings.length) return;
    setLoading(true);
    setTimeout(() => {
      setVisibleRows((prev) => [
        ...prev,
        ...listings.slice(prev.length, prev.length + batchSize),
      ]);
      setLoading(false);
    }, 500);
  }, [loading, visibleRows, listings]);

  // Intersection Observer to detect when user scrolls to the bottom
  React.useEffect(() => {
    if (!observerRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMoreListings();
        }
      },
      { threshold: 1 }
    );

    observer.observe(observerRef.current);

    return () => observer.disconnect();
  }, [loadMoreListings]);

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
          open={modalOpen}
          setOpen={setModalOpen}
        />
      )}

      {/* Sorting Buttons */}
      <div className="mb-4 flex justify-between w-full" style={{ maxWidth: '80%' }}>
        <button
          onClick={() => handleRequestSort('name')}
          className="px-4 py-2 bg-blue-500 text-white rounded"
        >
          Sort by Name ({orderBy === 'name' ? order : 'asc'})
        </button>
        <button
          onClick={() => handleRequestSort('lastUpdated')}
          className="px-4 py-2 bg-blue-500 text-white rounded"
        >
          Sort by Last Updated ({orderBy === 'lastUpdated' ? order : 'asc'})
        </button>
      </div>

      {/* List of Cards (Rows) */}
      <div className="w-full" style={{ maxWidth: '80%' }}>
        {visibleRows.map((listing) => (
          <div
            key={listing.id}
            onClick={() => openModalForListing(listing.id)}
            className="bg-gray-100 shadow-md rounded-lg p-4 mb-4 transition-transform hover:-translate-y-1 cursor-pointer"
          >
            {/* Header with Name and Departments */}
            <div className="flex justify-between items-center">
              <div className="flex items-center">
                <h2 className="text-lg font-semibold">{listing.name}</h2>
                <p className="text-gray-700 text-sm ml-4">
                  {listing.departments.replaceAll('; ', ', ')}
                </p>
              </div>
              <span className="text-sm text-gray-500">
                {new Date(listing.lastUpdated).toLocaleDateString('en-US', {
                  month: '2-digit',
                  day: '2-digit',
                  year: 'numeric'
                })}
              </span>
            </div>
            {/* Description and Lab Website on the same line */}
            <div className="flex items-center justify-between mt-2">
              <p className="text-gray-800 text-sm">
                {listing.description.length > 100
                  ? listing.description.slice(0, 90) + ' (see more...)'
                  : listing.description}
              </p>
              <a
                href={listing.website}
                onClick={(e) => e.stopPropagation()}
                className="ml-4"
                target="_blank"
                rel="noopener noreferrer"
              >
                <button className="p-2 bg-gray-200 rounded hover:bg-gray-300">
                  <img
                    src="/assets/icons/link-icon.png"
                    alt="Lab Website"
                    className="w-6 h-6"
                  />
                </button>
              </a>
            </div>
          </div>
        ))}
      </div>

      

      {/* Infinite Scroll Trigger */}
      <div ref={observerRef} className="h-10 w-full"></div>

      {/* Scroll to Top Button */}
      <button
        onClick={scrollToTop}
        className="fixed bottom-6 right-6 bg-blue-500 text-white p-3 rounded-full shadow-lg hover:bg-blue-700 transition"
      >
        ⬆️
      </button>

      {/* Loading Indicator */}
      {loading && <p className="text-gray-500 mt-4">Loading more listings...</p>}
    </div>
  );
}
