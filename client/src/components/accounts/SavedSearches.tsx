/**
 * Saved Searches surface for the account page.
 *
 * Lists the browse queries a signed-in student has saved from /research, backed
 * by the SavedSearch collection (served by /users/savedSearches). Each saved
 * search shows its label, a human-readable summary of its filters, and an in-app
 * new-match indicator counting the matching research homes that are new since the
 * student last opened it. Opening a saved search re-applies its exact query and
 * filters on /research and clears the indicator; students can also rename or
 * delete a saved search. The new-match count is computed on-demand server-side
 * and fails safe: when it cannot be computed the search still lists and runs.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import axios from '../../utils/axios';
import LoadingSpinner from '../shared/LoadingSpinner';
import type { SavedSearchView } from '../../types/savedSearch';
import {
  savedSearchDisplayLabel,
  savedSearchSummaryText,
  savedSearchTargetPath,
} from '../../utils/savedSearchSummary';

interface SavedSearchesProps {
  onCountChange?: (count: number) => void;
}

type RowStatus = 'idle' | 'saving' | 'error';

const MAX_SAVED_SEARCH_LABEL_LENGTH = 120;

const SavedSearches = ({ onCountChange }: SavedSearchesProps) => {
  const [searches, setSearches] = useState<SavedSearchView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [rowStatuses, setRowStatuses] = useState<Record<string, RowStatus>>({});
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;
    const load = async () => {
      setIsLoading(true);
      try {
        const response = await axios.get('/users/savedSearches', { withCredentials: true });
        if (!activeRef.current) return;
        setSearches((response.data.savedSearches || []) as SavedSearchView[]);
        setLoadError(false);
      } catch {
        if (!activeRef.current) return;
        console.error('Error fetching saved searches.');
        setSearches([]);
        setLoadError(true);
      } finally {
        if (activeRef.current) setIsLoading(false);
      }
    };
    void load();
    return () => {
      activeRef.current = false;
    };
  }, []);

  useEffect(() => {
    onCountChange?.(searches.length);
  }, [searches.length, onCountChange]);

  const totalNewMatches = useMemo(
    () => searches.reduce((sum, search) => sum + Math.max(0, search.newMatchCount ?? 0), 0),
    [searches],
  );

  const setRowStatus = (id: string, status: RowStatus) =>
    setRowStatuses((current) => ({ ...current, [id]: status }));

  const markViewed = (id: string) => {
    setSearches((current) =>
      current.map((search) => (search._id === id ? { ...search, newMatchCount: 0 } : search)),
    );
    axios
      .post(`/users/savedSearches/${id}/viewed`, {}, { withCredentials: true })
      .catch(() => console.error('Error marking saved search viewed.'));
  };

  const beginRename = (search: SavedSearchView) => {
    setEditingId(search._id);
    setEditingLabel(search.label);
    setRowStatus(search._id, 'idle');
  };

  const cancelRename = () => {
    setEditingId(null);
    setEditingLabel('');
  };

  const submitRename = async (id: string) => {
    const nextLabel = editingLabel.trim().slice(0, MAX_SAVED_SEARCH_LABEL_LENGTH);
    setRowStatus(id, 'saving');
    try {
      const response = await axios.put(
        `/users/savedSearches/${id}`,
        { data: { label: nextLabel } },
        { withCredentials: true },
      );
      if (!activeRef.current) return;
      setSearches((response.data.savedSearches || []) as SavedSearchView[]);
      setRowStatus(id, 'idle');
      cancelRename();
    } catch {
      console.error('Error renaming saved search.');
      if (activeRef.current) setRowStatus(id, 'error');
    }
  };

  const deleteSearch = async (id: string) => {
    const previous = searches;
    setSearches((current) => current.filter((search) => search._id !== id));
    try {
      const response = await axios.delete(`/users/savedSearches/${id}`, {
        withCredentials: true,
      });
      if (!activeRef.current) return;
      setSearches((response.data.savedSearches || []) as SavedSearchView[]);
    } catch {
      console.error('Error deleting saved search.');
      if (activeRef.current) {
        setSearches(previous);
        setRowStatus(id, 'error');
      }
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center pt-12">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <section>
      <div className="mb-2">
        <h2 className="text-2xl font-bold text-gray-800">Saved searches</h2>
        <p className="mt-1 text-sm text-gray-500">
          Browse queries you saved from Research, with a count of matching research homes that are
          new since you last opened each one. Open one to re-run it, or rename and delete as your
          interests change.
        </p>
        {totalNewMatches > 0 && (
          <p className="mt-1 text-sm font-semibold text-[var(--yr-blue)]" role="status">
            {totalNewMatches} new {totalNewMatches === 1 ? 'match' : 'matches'} across your saved
            searches
          </p>
        )}
      </div>

      {loadError && (
        <p className="mb-3 text-sm text-red-700" role="alert">
          We could not load your saved searches. Check your connection or sign in again, then
          reload.
        </p>
      )}

      {searches.length > 0 ? (
        <ul>
          {searches.map((search) => {
            const isEditing = editingId === search._id;
            const status = rowStatuses[search._id];
            const newMatches = Math.max(0, search.newMatchCount ?? 0);
            const displayLabel = savedSearchDisplayLabel(search);
            return (
              <li key={search._id} className="yr-card mb-2 rounded-md p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <div className="flex flex-col gap-2">
                        <label
                          htmlFor={`saved-search-label-${search._id}`}
                          className="text-xs font-medium text-gray-600"
                        >
                          Rename saved search
                        </label>
                        <input
                          id={`saved-search-label-${search._id}`}
                          type="text"
                          value={editingLabel}
                          maxLength={MAX_SAVED_SEARCH_LABEL_LENGTH}
                          placeholder={search.queryText || 'Saved search'}
                          onChange={(event) => setEditingLabel(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              void submitRename(search._id);
                            } else if (event.key === 'Escape') {
                              event.preventDefault();
                              cancelRename();
                            }
                          }}
                          className="w-full rounded-md border border-[var(--yr-line)] px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => void submitRename(search._id)}
                            className="inline-flex min-h-[44px] items-center rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft"
                          >
                            Save name
                          </button>
                          <button
                            type="button"
                            onClick={cancelRename}
                            className="inline-flex min-h-[44px] items-center rounded-md border border-[var(--yr-line)] px-3 py-2 text-sm font-semibold text-gray-700 hover:border-[var(--yr-line-strong)] hover:text-gray-900"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-base font-semibold text-gray-950">
                            {displayLabel}
                          </h3>
                          {newMatches > 0 && (
                            <span
                              className="inline-flex items-center rounded-full bg-[var(--yr-blue)] px-2 py-0.5 text-xs font-semibold text-white"
                              aria-label={`${newMatches} new ${
                                newMatches === 1 ? 'match' : 'matches'
                              } since you last opened this search`}
                            >
                              {newMatches} new
                            </span>
                          )}
                        </div>
                        <p className="mt-1 truncate text-sm text-gray-600">
                          {savedSearchSummaryText(search)}
                        </p>
                      </>
                    )}
                  </div>
                  {!isEditing && (
                    <div className="flex shrink-0 flex-row gap-2">
                      <Link
                        to={savedSearchTargetPath(search)}
                        onClick={() => markViewed(search._id)}
                        className="inline-flex min-h-[44px] items-center rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft"
                      >
                        Open
                      </Link>
                      <button
                        type="button"
                        onClick={() => beginRename(search)}
                        aria-label={`Rename ${displayLabel}`}
                        className="inline-flex min-h-[44px] items-center rounded-md border border-[var(--yr-line)] px-3 py-2 text-sm font-semibold text-gray-700 hover:border-[var(--yr-line-strong)] hover:text-gray-900"
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteSearch(search._id)}
                        aria-label={`Delete ${displayLabel}`}
                        className="inline-flex min-h-[44px] items-center rounded-md border border-[var(--yr-line)] px-3 py-2 text-sm font-semibold text-red-700 hover:border-red-300 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
                {status === 'error' && (
                  <p className="mt-2 text-xs text-red-700" role="alert">
                    Something went wrong. Check your connection or sign in again, then retry.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        !loadError && (
          <div className="rounded-md border border-dashed border-[var(--yr-line-strong)] bg-[var(--yr-panel-muted)] p-5 text-center">
            <h3 className="text-base font-semibold text-gray-950">No saved searches yet</h3>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-gray-600">
              When you narrow Research down to the labs and programs you care about, save that search
              to re-run it in one click and see when new research homes start matching.
            </p>
            <Link
              to="/research"
              className="mt-4 inline-flex min-h-[44px] items-center rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft"
            >
              Browse Research
            </Link>
          </div>
        )
      )}
    </section>
  );
};

export default SavedSearches;
