/**
 * Account dashboard section for saved programs.
 *
 * Legacy listing favorites are no longer a student/faculty-facing surface.
 * Program favorites keep their tracking, export, and detail modal behavior.
 */
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Fellowship, FellowshipStage } from '../../types/types';
import {
  accountTrackingReducer,
  loadAccountTrackingFromStorage,
} from '../../reducers/accountTrackingReducer';
import {
  createInitialFavoritesState,
  favoritesReducer,
} from '../../reducers/favoritesReducer';
import { BrowsableItem } from '../../types/browsable';
import { createFellowship } from '../../utils/createFellowship';
import BrowseListItem from '../shared/BrowseListItem';
import FellowshipModal from '../fellowship/FellowshipModal';
import LoadingSpinner from '../shared/LoadingSpinner';
import axios from '../../utils/axios';
import swal from 'sweetalert';
import { exportToGoogleSheets as createGoogleSheet } from '../../utils/googleSheets';
import { openSafeUrlInNewTab } from '../../utils/url';

interface FavoritesManagerProps {
  variant?: 'student' | 'professor';
  onSummaryChange?: (summary: {
    count: number;
    nextDeadlineLabel?: string;
    nextDeadlineDate?: string;
  }) => void;
}

const fellowshipToBrowsable = (fellowship: Fellowship): BrowsableItem => ({
  type: 'fellowship',
  data: fellowship,
});

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

const validDeadlineDate = (value?: string | null): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const deadlineEndOfUtcDay = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));

const SPREADSHEET_FORMULA_PREFIX = /^[\s\u0000-\u001f]*[=+\-@]/;

const csvCell = (cell: unknown): string => {
  const value = String(cell ?? '');
  const neutralizedValue = SPREADSHEET_FORMULA_PREFIX.test(value) ? `'${value}` : value;
  return `"${neutralizedValue.replace(/"/g, '""')}"`;
};

export const savedProgramDeadlineSummary = (
  fellowships: Fellowship[],
  now = new Date(),
): { nextDeadlineDate?: string; nextDeadlineLabel?: string } => {
  const upcoming = fellowships
    .map((fellowship) => {
      const date = validDeadlineDate(fellowship.deadline);
      if (!date || deadlineEndOfUtcDay(date).getTime() < now.getTime()) return null;
      return { fellowship, date };
    })
    .filter((item): item is { fellowship: Fellowship; date: Date } => Boolean(item))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const next = upcoming[0];
  if (!next) return {};

  return {
    nextDeadlineDate: next.fellowship.deadline || undefined,
    nextDeadlineLabel: `${next.fellowship.title}: Due ${dateFormatter.format(next.date)}`,
  };
};

const FavoritesManager = ({ variant = 'student', onSummaryChange }: FavoritesManagerProps) => {
  const isProfessorVariant = variant === 'professor';
  const [favState, favDispatch] = useReducer(favoritesReducer, undefined, () =>
    createInitialFavoritesState(),
  );
  const {
    favFellowships,
    favFellowshipIds,
  } = favState;

  const [tracking, trackingDispatch] = useReducer(accountTrackingReducer, undefined, () =>
    loadAccountTrackingFromStorage(localStorage),
  );
  const {
    fellowshipStage,
    fellowshipNotes,
    editingFellowshipNoteId,
  } = tracking;

  const [isLoading, setIsLoading] = useState(true);
  const [isFellowshipModalOpen, setIsFellowshipModalOpen] = useState(false);
  const [selectedFellowship, setSelectedFellowship] = useState<Fellowship | null>(null);
  const [showFellowshipExportMenu, setShowFellowshipExportMenu] = useState(false);
  const fellowshipExportMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem('yale-research-fellowship-stages', JSON.stringify(fellowshipStage));
  }, [fellowshipStage]);

  useEffect(() => {
    localStorage.setItem('yale-research-fellowship-notes', JSON.stringify(fellowshipNotes));
  }, [fellowshipNotes]);

  useEffect(() => {
    if (!showFellowshipExportMenu) return;
    const handler = (event: MouseEvent) => {
      if (
        fellowshipExportMenuRef.current &&
        !fellowshipExportMenuRef.current.contains(event.target as Node)
      ) {
        setShowFellowshipExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showFellowshipExportMenu]);

  const reloadFavorites = async () => {
    setIsLoading(true);
    try {
      const response = await axios.get('/users/savedPrograms');
      const rawFellowships = response.data.savedPrograms || [];
      const fellowships: Fellowship[] = rawFellowships.map((f: any) => createFellowship(f));
      favDispatch({
        type: 'SET_FAV_FELLOWSHIPS',
        favFellowships: fellowships,
        favFellowshipIds: fellowships.map((fellowship) => fellowship.id),
      });
    } catch (error) {
      console.error("Error fetching user's favorite programs:", error);
      favDispatch({
        type: 'SET_FAV_FELLOWSHIPS',
        favFellowships: [],
        favFellowshipIds: [],
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    reloadFavorites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nextProgramDeadline = useMemo(
    () => savedProgramDeadlineSummary(favFellowships),
    [favFellowships],
  );

  useEffect(() => {
    onSummaryChange?.({
      count: favFellowships.length,
      ...nextProgramDeadline,
    });
  }, [favFellowships.length, nextProgramDeadline, onSummaryChange]);

  const openFellowshipModal = (fellowship: Fellowship) => {
    setSelectedFellowship(fellowship);
    setIsFellowshipModalOpen(true);
  };

  const closeFellowshipModal = () => {
    setIsFellowshipModalOpen(false);
    setSelectedFellowship(null);
  };

  const updateFellowshipFavorite = (fellowshipId: string, favorite: boolean) => {
    const prevFavFellowships = favFellowships;
    const prevFavFellowshipIds = favFellowshipIds;

    if (favorite) {
      favDispatch({ type: 'ADD_FAV_FELLOWSHIP_ID', fellowshipId });
      axios
        .put('/users/savedPrograms', {
          withCredentials: true,
          data: { savedPrograms: [fellowshipId] },
        })
        .catch((error) => {
          favDispatch({
            type: 'HYDRATE',
            payload: {
              favFellowships: prevFavFellowships,
              favFellowshipIds: prevFavFellowshipIds,
            },
          });
          console.error('Error saving program:', error);
          swal({ text: 'Unable to save program', icon: 'warning' });
          reloadFavorites();
        });
    } else {
      favDispatch({ type: 'REMOVE_FAV_FELLOWSHIP', fellowshipId });
      axios
        .delete('/users/savedPrograms', {
          withCredentials: true,
          data: { savedPrograms: [fellowshipId] },
        })
        .catch((error) => {
          favDispatch({
            type: 'HYDRATE',
            payload: {
              favFellowships: prevFavFellowships,
              favFellowshipIds: prevFavFellowshipIds,
            },
          });
          console.error('Error removing saved program:', error);
          swal({ text: 'Unable to remove saved program', icon: 'warning' });
          reloadFavorites();
        });
    }
  };

  const handleFellowshipStageChange = (fellowshipId: string, stage: FellowshipStage) => {
    trackingDispatch({ type: 'SET_FELLOWSHIP_STAGE', fellowshipId, stage });
  };

  const exportFellowshipsToCSV = () => {
    if (favFellowships.length === 0) {
      swal({ text: 'No programs to export', icon: 'info' });
      return;
    }

    const headers = isProfessorVariant
      ? ['Program Name', 'Deadline', 'Award Amount', 'Status', 'Application Link', 'Contact']
      : [
          'Program Name',
          'Deadline',
          'Award Amount',
          'Status',
          'Applied',
          'Notes',
          'Application Link',
          'Contact',
        ];
    const rows = favFellowships.map((fellowship) => [
      fellowship.title,
      fellowship.deadline ? new Date(fellowship.deadline).toLocaleDateString() : 'No deadline',
      fellowship.awardAmount || '',
      fellowship.isAcceptingApplications ? 'Accepting' : 'Closed',
      ...(
        isProfessorVariant
          ? []
          : [
              (fellowshipStage[fellowship.id] || 'not_applied') === 'applied'
                ? 'Applied'
                : 'Not Applied',
              fellowshipNotes[fellowship.id] || '',
            ]
      ),
      fellowship.applicationLink || '',
      fellowship.contactEmail || fellowship.contactName || '',
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => csvCell(cell)).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `yale-research-programs-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportFellowshipsToGoogleSheets = async () => {
    if (favFellowships.length === 0) {
      swal({ text: 'No programs to export', icon: 'info' });
      return;
    }

    const headers = isProfessorVariant
      ? ['Program Name', 'Deadline', 'Award Amount', 'Status', 'Application Link', 'Contact']
      : [
          'Program Name',
          'Deadline',
          'Award Amount',
          'Status',
          'Applied',
          'Notes',
          'Application Link',
          'Contact',
        ];
    const rows = favFellowships.map((fellowship) => [
      fellowship.title,
      fellowship.deadline ? new Date(fellowship.deadline).toLocaleDateString() : 'No deadline',
      fellowship.awardAmount || '',
      fellowship.isAcceptingApplications ? 'Accepting' : 'Closed',
      ...(
        isProfessorVariant
          ? []
          : [
              (fellowshipStage[fellowship.id] || 'not_applied') === 'applied'
                ? 'Applied'
                : 'Not Applied',
              fellowshipNotes[fellowship.id] || '',
            ]
      ),
      fellowship.applicationLink || '',
      fellowship.contactEmail || fellowship.contactName || '',
    ]);

    try {
      const url = await createGoogleSheet(
        `Yale Research Programs - ${new Date().toISOString().slice(0, 10)}`,
        headers,
        rows,
      );
      openSafeUrlInNewTab(url);
      swal({ text: 'Google Sheet created!', icon: 'success', timer: 2000 });
    } catch (error) {
      console.error('Google Sheets export failed:', error);
      exportFellowshipsToCSV();
      swal({ text: 'Could not create Google Sheet. CSV downloaded instead.', icon: 'info' });
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
    <>
      <div
        className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${
          isProfessorVariant ? 'mb-4' : 'mb-2'
        }`}
      >
        <div>
          <h2 className="text-2xl font-bold text-gray-800">
            {isProfessorVariant ? 'Funding & program references' : 'Program watchlist'}
          </h2>
          {isProfessorVariant ? (
            <p className="mt-1 max-w-2xl text-sm text-gray-500">
              Save programs students may ask about. This is optional reference material, not an
              application tracker.
            </p>
          ) : (
            <p className="mt-1 text-sm text-gray-500">
              Saved programs stay here as supporting deadlines and funding leads.
            </p>
          )}
        </div>
        {favFellowships.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <div className="relative" ref={fellowshipExportMenuRef}>
	              <button
	                onClick={() => setShowFellowshipExportMenu(!showFellowshipExportMenu)}
	                className="inline-flex min-h-[44px] items-center gap-1 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs font-semibold text-green-700 transition-colors hover:bg-green-100"
	              >
	                Export
	              </button>
              {showFellowshipExportMenu && (
                <div className="absolute right-0 top-full mt-1 bg-[var(--yr-panel)] border border-[var(--yr-line)] rounded-md shadow-lg z-20 min-w-[180px]">
                  <button
                    onClick={() => {
                      exportFellowshipsToCSV();
                      setShowFellowshipExportMenu(false);
                    }}
	                    className="min-h-[44px] w-full px-3 py-2 text-left text-sm hover:bg-[var(--yr-panel-muted)]"
                  >
                    Export as CSV
                  </button>
                  <button
                    onClick={() => {
                      exportFellowshipsToGoogleSheets();
                      setShowFellowshipExportMenu(false);
                    }}
	                    className="min-h-[44px] w-full border-t border-[var(--yr-line)] px-3 py-2 text-left text-sm hover:bg-[var(--yr-panel-muted)]"
                  >
                    Open in Google Sheets
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {favFellowships.length > 0 ? (
        <ul>
            {favFellowships.map((fellowship) => (
              <li key={fellowship.id} className="mb-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                  <div className="flex-1">
                    <BrowseListItem
                      item={fellowshipToBrowsable(fellowship)}
                      isFavorite={favFellowshipIds.includes(fellowship.id)}
                      onToggleFavorite={(event) => {
                        event.stopPropagation();
                        updateFellowshipFavorite(
                          fellowship.id,
                          !favFellowshipIds.includes(fellowship.id),
                        );
                      }}
                      onOpenModal={() => openFellowshipModal(fellowship)}
                    />
                  </div>
                  {!isProfessorVariant && (
                    <div className="flex flex-row gap-1 sm:flex-col sm:justify-center">
	                      <button
	                        onClick={() =>
	                          handleFellowshipStageChange(
                            fellowship.id,
                            (fellowshipStage[fellowship.id] || 'not_applied') === 'applied'
                              ? 'not_applied'
                              : 'applied',
	                            )
	                        }
	                        aria-label={
	                          (fellowshipStage[fellowship.id] || 'not_applied') === 'applied'
	                            ? 'Mark as not applied'
	                            : 'Mark as applied'
	                        }
	                        className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded border p-2 transition-colors ${
	                          (fellowshipStage[fellowship.id] || 'not_applied') === 'applied'
	                            ? 'bg-green-50 border-green-300 text-green-600'
	                            : 'border-[var(--yr-line)] text-gray-400 hover:text-gray-600 hover:border-[var(--yr-line-strong)]'
                        }`}
                        title={
                          (fellowshipStage[fellowship.id] || 'not_applied') === 'applied'
                            ? 'Mark as not applied'
                            : 'Mark as applied'
                        }
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill={
                            (fellowshipStage[fellowship.id] || 'not_applied') === 'applied'
                              ? 'currentColor'
                              : 'none'
                          }
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </button>
	                      <button
	                        onClick={() =>
	                          trackingDispatch({
                            type: 'TOGGLE_EDITING_FELLOWSHIP_NOTE',
	                            fellowshipId: fellowship.id,
	                          })
	                        }
	                        aria-label="Add note"
	                        className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded border p-2 transition-colors ${
	                          fellowshipNotes[fellowship.id]
	                            ? 'bg-yellow-50 border-yellow-300 text-yellow-600'
	                            : 'border-[var(--yr-line)] text-gray-400 hover:text-gray-600 hover:border-[var(--yr-line-strong)]'
                        }`}
                        title="Add note"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
                {!isProfessorVariant && editingFellowshipNoteId === fellowship.id && (
                  <div className="mt-1">
                      <textarea
                      aria-label={`Note for ${fellowship.title}`}
                      value={fellowshipNotes[fellowship.id] || ''}
                      onChange={(event) =>
                        trackingDispatch({
                          type: 'SET_FELLOWSHIP_NOTE',
                          fellowshipId: fellowship.id,
                          value: event.target.value,
                        })
                      }
                      placeholder="Add a note about this program..."
                      rows={2}
                      className="w-full text-sm border border-[var(--yr-line)] rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                )}
                {!isProfessorVariant &&
                  fellowshipNotes[fellowship.id] &&
                  editingFellowshipNoteId !== fellowship.id && (
                    <p className="text-xs text-gray-500 mt-0.5 ml-1 italic truncate">
                      Note: {fellowshipNotes[fellowship.id]}
                    </p>
                  )}
              </li>
            ))}
        </ul>
      ) : (
        <div className="rounded-md border border-dashed border-[var(--yr-line-strong)] bg-[var(--yr-panel-muted)] p-5 text-center">
          <h3 className="text-base font-semibold text-gray-950">No saved programs yet</h3>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-gray-600">
            {isProfessorVariant
              ? 'Save fellowships or structured programs here when they are useful context for students who ask about funding routes.'
              : 'When a program or fellowship looks like a possible fit, save it here to track deadlines, notes, and application status.'}
          </p>
          <Link
            to="/programs"
            className="mt-4 inline-flex min-h-[44px] items-center rounded-md bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
          >
            Programs & Fellowships
          </Link>
        </div>
      )}

      {selectedFellowship && (
        <FellowshipModal
          fellowship={selectedFellowship}
          isOpen={isFellowshipModalOpen}
          onClose={closeFellowshipModal}
          isFavorite={favFellowshipIds.includes(selectedFellowship.id)}
          toggleFavorite={() => {
            updateFellowshipFavorite(
              selectedFellowship.id,
              !favFellowshipIds.includes(selectedFellowship.id),
            );
          }}
        />
      )}
    </>
  );
};

export default FavoritesManager;
