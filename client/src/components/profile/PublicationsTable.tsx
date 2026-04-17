/**
 * Profile tab displaying academic publications.
 */
import { useState, useEffect } from 'react';
import { Publication } from '../../types/types';
import axios from '../../utils/axios';
import { safeUrl } from '../../utils/url';

interface PublicationsTableProps {
  netid: string;
}

type SortField = 'year' | 'title' | 'venue' | 'cited_by_count';

const PublicationsTable = ({ netid }: PublicationsTableProps) => {
  const [publications, setPublications] = useState<Publication[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<SortField>('year');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [loading, setLoading] = useState(true);
  const pageSize = 20;

  useEffect(() => {
    setLoading(true);
    axios
      .get(`/profiles/${netid}/publications`, {
        params: { page, pageSize, sortBy, sortOrder },
      })
      .then((res) => {
        setPublications(res.data.publications);
        setTotal(res.data.total);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [netid, page, sortBy, sortOrder]);

  const toggleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortOrder(field === 'title' || field === 'venue' ? 'asc' : 'desc');
    }
    setPage(1);
  };

  const totalPages = Math.ceil(total / pageSize);

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortBy !== field) return <span className="text-gray-300 ml-1">&#x2195;</span>;
    return <span className="ml-1">{sortOrder === 'asc' ? '&#x25B2;' : '&#x25BC;'}</span>;
  };

  if (loading && publications.length === 0) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (total === 0) {
    return <p className="text-gray-500 text-sm py-8 text-center">No publications available.</p>;
  }

  return (
    <div>
      <p className="text-sm text-gray-500 mb-3">{total} publication{total !== 1 ? 's' : ''}</p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th
                className="text-left py-2 px-2 font-semibold text-gray-600 cursor-pointer hover:text-gray-900 whitespace-nowrap"
                onClick={() => toggleSort('year')}
              >
                Year <SortIcon field="year" />
              </th>
              <th
                className="text-left py-2 px-2 font-semibold text-gray-600 cursor-pointer hover:text-gray-900"
                onClick={() => toggleSort('title')}
              >
                Title <SortIcon field="title" />
              </th>
              <th
                className="text-left py-2 px-2 font-semibold text-gray-600 cursor-pointer hover:text-gray-900"
                onClick={() => toggleSort('venue')}
              >
                Venue <SortIcon field="venue" />
              </th>
              <th
                className="text-right py-2 px-2 font-semibold text-gray-600 cursor-pointer hover:text-gray-900 whitespace-nowrap"
                onClick={() => toggleSort('cited_by_count')}
              >
                Citations <SortIcon field="cited_by_count" />
              </th>
            </tr>
          </thead>
          <tbody>
            {publications.map((pub, i) => (
              <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2 px-2 text-gray-500 whitespace-nowrap">{pub.year || '—'}</td>
                <td className="py-2 px-2">
                  <div className="flex items-start gap-1.5">
                    <span className="text-gray-800">{pub.title}</span>
                    {pub.doi && (
                      <a
                        href={`https://doi.org/${pub.doi}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-shrink-0 text-blue-500 hover:text-blue-700"
                        title="Open DOI"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                      </a>
                    )}
                    {pub.open_access_url && !pub.doi && safeUrl(pub.open_access_url) && (
                      <a
                        href={safeUrl(pub.open_access_url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-shrink-0 text-green-500 hover:text-green-700"
                        title="Open Access"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                      </a>
                    )}
                  </div>
                </td>
                <td className="py-2 px-2 text-gray-500 max-w-[200px] truncate">{pub.venue || '—'}</td>
                <td className="py-2 px-2 text-right text-gray-500">{pub.cited_by_count ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <span className="text-sm text-gray-500">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
};

export default PublicationsTable;
