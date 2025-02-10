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
  const [page, setPage] = React.useState(0);
  const [rowsPerPage, setRowsPerPage] = React.useState(10);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [selectedListingId, setSelectedListingId] = React.useState<number | null>(null);

  React.useEffect(() => {
    setPage(0);
  }, [listings]);

  const handleRequestSort = (property: keyof Listing) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
  };

  const openModalForListing = (listingId: number) => {
    setSelectedListingId(listingId);
    setModalOpen(true);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const totalPages = Math.ceil(listings.length / rowsPerPage);

  const handlePrevPage = () => setPage((prev) => Math.max(prev - 1, 0));
  const handleNextPage = () => setPage((prev) => Math.min(prev + 1, totalPages - 1));

  const visibleRows = React.useMemo(
    () =>
      listings
        .sort(getComparator(order, orderBy))
        .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [listings, order, orderBy, page, rowsPerPage]
  );

  return (
    <div className="flex flex-col items-center p-4">

      {/* Modal */}
      {selectedListingId !== null && (
        <ListingsModal
          listing={listings.find((l) => l.id === selectedListingId)!}
          open={modalOpen}
          setOpen={setModalOpen}
        />
      )}

      {/* Sorting Buttons */}
      <div className="mb-4 flex justify-between w-full max-w-5xl">
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
      <div className="w-full max-w-5xl">
        {visibleRows.map((listing) => (
          <div
            key={listing.id}
            onClick={() => openModalForListing(listing.id)}
            className="bg-gray-100 shadow-md rounded-lg p-4 mb-4 transition-transform hover:-translate-y-1 cursor-pointer"
          >
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold">{listing.name}</h2>
              <span className="text-sm text-gray-500">{listing.lastUpdated}</span>
            </div>
            <p className="text-gray-700 text-sm mt-2">{listing.departments.replaceAll('; ', ', ')}</p>
            <p className="text-gray-800 mt-2">
              {listing.description.length > 100 ? listing.description.slice(0, 90) + ' (see more...)' : listing.description}
            </p>
            <a
              href={listing.website}
              onClick={(e) => e.stopPropagation()}
              className="text-blue-500 underline mt-2 inline-block"
              target="_blank"
              rel="noopener noreferrer"
            >
              Lab Website
            </a>
          </div>
        ))}
      </div>

      {/* Pagination */}
      <div className="mt-6 flex items-center space-x-4">
        <button
          onClick={handlePrevPage}
          disabled={page === 0}
          className="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          Previous
        </button>
        <div className="text-gray-700">
          Page <span className="font-bold">{page + 1}</span> of {totalPages}
        </div>
        <button
          onClick={handleNextPage}
          disabled={page === totalPages - 1 || totalPages === 0}
          className="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          Next
        </button>

        <label className="ml-4 text-gray-700">
          Rows per page:&nbsp;
          <select
            value={rowsPerPage}
            onChange={handleChangeRowsPerPage}
            className="border rounded px-2 py-1"
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
          </select>
        </label>
      </div>
    </div>
  );
}
