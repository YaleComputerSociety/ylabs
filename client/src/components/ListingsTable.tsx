import * as React from 'react';
import ListingsModal from './ListingsModal';
import { Listing } from '../types/types';

type Order = 'asc' | 'desc';

type ListingsCardListProps = {
  listings: Listing[];
  sortableKeys: (keyof Listing)[];
};

export default function ListingsCardList({ listings, sortableKeys }: ListingsCardListProps) {
  const [order, setOrder] = React.useState<Order>('asc');
  const [orderIndex, setOrderIndex] = React.useState(0);
  const [sortedRows, setSortedRows] = React.useState<Listing[]>([]);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [selectedListingId, setSelectedListingId] = React.useState<number | null>(null);

  const buttonTranslations: Record<string, string[]> = {
    'name': ['Name', 'A-Z', 'Z-A'],
    'lastUpdated': ['Date', 'Newest', 'Oldest']
  }

  React.useEffect(() => {
    const property = sortableKeys[orderIndex];

    // Sort the listings based on the new order
    let sortedListings;

    if(property == 'lastUpdated') {
      sortedListings = [...listings].sort((a, b) =>
        order === 'asc'
          ? new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime()
          : new Date(a.lastUpdated).getTime() - new Date(b.lastUpdated).getTime()
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
  }, [order, orderIndex, listings]);

  const handleToggleSortKey = () => {
    setOrderIndex((prevIndex) => (prevIndex + 1) % sortableKeys.length);
  }

  const handleToggleOrder = () => {
    setOrder((prevOrder) => prevOrder === 'asc' ? 'desc' : 'asc');
  }

  const openModalForListing = (listingId: number) => {
    setSelectedListingId(listingId);
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
          open={modalOpen}
          setOpen={setModalOpen}
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
        {sortedRows.map((listing) => (
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
