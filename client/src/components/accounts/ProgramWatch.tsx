/**
 * Program Watch surface for the account page.
 *
 * Lists the programs and fellowships an account is watching, backed by the
 * canonical ResearchPlan PROGRAM targets (served by /users/watchedPrograms and
 * /users/watchedProgramPlans). Each watched program keeps its at-a-glance info
 * (deadline, accepting status, eligibility), a link to the program, a private
 * note, an applied marker, and an unwatch control. Watching is a personal
 * bookmark; program content stays read-only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Fellowship } from '../../types/types';
import { BrowsableItem } from '../../types/browsable';
import { createFellowship } from '../../utils/createFellowship';
import BrowseListItem from '../shared/BrowseListItem';
import FellowshipModal from '../fellowship/FellowshipModal';
import LoadingSpinner from '../shared/LoadingSpinner';
import useFavorites from '../../hooks/useFavorites';
import axios from '../../utils/axios';

interface ProgramWatchProps {
  onSummaryChange?: (summary: {
    count: number;
    nextDeadlineLabel?: string;
    nextDeadlineDate?: string;
  }) => void;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const MAX_PROGRAM_NOTE_LENGTH = 2000;

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

export const watchedProgramDeadlineSummary = (
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

  const prefix = next.fellowship.isAcceptingApplications
    ? `${next.fellowship.title}: Now open; due `
    : `${next.fellowship.title}: Due `;
  return {
    nextDeadlineDate: next.fellowship.deadline || undefined,
    nextDeadlineLabel: `${prefix}${dateFormatter.format(next.date)}`,
  };
};

const ProgramWatch = ({ onSummaryChange }: ProgramWatchProps) => {
  const { favIds: watchedIds, toggleFavorite } = useFavorites('watchedPrograms');
  const [programs, setPrograms] = useState<Fellowship[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [applied, setApplied] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saveStatuses, setSaveStatuses] = useState<Record<string, SaveStatus>>({});
  const [selectedProgram, setSelectedProgram] = useState<Fellowship | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const noteTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    let active = true;
    const load = async () => {
      setIsLoading(true);
      try {
        const [programResponse, planResponse] = await Promise.all([
          axios.get('/users/watchedPrograms', { withCredentials: true }),
          axios.get('/users/watchedProgramPlans', { withCredentials: true }),
        ]);
        if (!active) return;
        const rawPrograms = programResponse.data.watchedPrograms || [];
        const loadedPrograms: Fellowship[] = rawPrograms.map((program: any) =>
          createFellowship(program),
        );
        const plans = (planResponse.data.watchedProgramPlans || {}) as Record<
          string,
          { privateNotes?: string; stage?: string }
        >;
        const loadedNotes: Record<string, string> = {};
        const loadedApplied: Record<string, boolean> = {};
        for (const program of loadedPrograms) {
          loadedNotes[program.id] = plans[program.id]?.privateNotes || '';
          loadedApplied[program.id] = plans[program.id]?.stage === 'APPLIED';
        }
        setPrograms(loadedPrograms);
        setNotes(loadedNotes);
        setApplied(loadedApplied);
      } catch {
        if (!active) return;
        console.error('Error fetching watched programs.');
        setPrograms([]);
        setNotes({});
        setApplied({});
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void load();
    const timers = noteTimersRef.current;
    return () => {
      active = false;
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  const visiblePrograms = useMemo(
    () => programs.filter((program) => watchedIds.includes(program.id)),
    [programs, watchedIds],
  );

  const nextDeadline = useMemo(
    () => watchedProgramDeadlineSummary(visiblePrograms),
    [visiblePrograms],
  );

  useEffect(() => {
    onSummaryChange?.({ count: visiblePrograms.length, ...nextDeadline });
  }, [visiblePrograms.length, nextDeadline, onSummaryChange]);

  const savePlan = useCallback(
    async (programId: string, plan: { privateNotes?: string; stage?: string }) => {
      setSaveStatuses((statuses) => ({ ...statuses, [programId]: 'saving' }));
      try {
        await axios.put(`/users/watchedProgramPlans/${programId}`, { data: { plan } });
        setSaveStatuses((statuses) => ({ ...statuses, [programId]: 'saved' }));
      } catch {
        console.error('Error saving watched program plan.');
        setSaveStatuses((statuses) => ({ ...statuses, [programId]: 'error' }));
      }
    },
    [],
  );

  const scheduleNoteSave = (programId: string, note: string) => {
    clearTimeout(noteTimersRef.current[programId]);
    setSaveStatuses((statuses) => ({ ...statuses, [programId]: 'idle' }));
    noteTimersRef.current[programId] = setTimeout(() => {
      void savePlan(programId, { privateNotes: note });
    }, 700);
  };

  const flushNoteSave = (programId: string) => {
    clearTimeout(noteTimersRef.current[programId]);
    void savePlan(programId, { privateNotes: notes[programId] || '' });
  };

  const toggleApplied = (programId: string) => {
    const next = !applied[programId];
    setApplied((current) => ({ ...current, [programId]: next }));
    void savePlan(programId, { stage: next ? 'APPLIED' : 'SAVED' });
  };

  const openModal = (program: Fellowship) => {
    setSelectedProgram(program);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedProgram(null);
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
        <h2 className="text-2xl font-bold text-gray-800">Program watch</h2>
        <p className="mt-1 text-sm text-gray-500">
          Programs and fellowships you are watching, with their deadlines, accepting status, and
          eligibility. Open one to see its details, or unwatch it.
        </p>
      </div>

      {visiblePrograms.length > 0 ? (
        <ul>
          {visiblePrograms.map((program) => {
            const status = saveStatuses[program.id];
            const isEditing = editingId === program.id;
            const note = notes[program.id] || '';
            const hasApplied = applied[program.id] === true;
            return (
              <li key={program.id} className="mb-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                  <div className="flex-1">
                    <BrowseListItem
                      item={fellowshipToBrowsable(program)}
                      isFavorite={watchedIds.includes(program.id)}
                      onToggleFavorite={(event) => {
                        event.stopPropagation();
                        toggleFavorite(program.id);
                      }}
                      onOpenModal={() => openModal(program)}
                    />
                  </div>
                  <div className="flex flex-row gap-1 sm:flex-col sm:justify-center">
                    <button
                      type="button"
                      onClick={() => toggleApplied(program.id)}
                      aria-pressed={hasApplied}
                      aria-label={
                        hasApplied
                          ? `Mark ${program.title} as not applied`
                          : `Mark ${program.title} as applied`
                      }
                      title={hasApplied ? 'Mark as not applied' : 'Mark as applied'}
                      className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded border p-2 transition-colors ${
                        hasApplied
                          ? 'border-green-300 bg-green-50 text-green-600'
                          : 'border-[var(--yr-line)] text-gray-400 hover:border-[var(--yr-line-strong)] hover:text-gray-600'
                      }`}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill={hasApplied ? 'currentColor' : 'none'}
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setEditingId((current) => (current === program.id ? null : program.id))
                      }
                      aria-expanded={isEditing}
                      aria-label={
                        isEditing ? `Hide note for ${program.title}` : `Add note for ${program.title}`
                      }
                      title={isEditing ? 'Hide note' : 'Add note'}
                      className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded border p-2 transition-colors ${
                        note
                          ? 'border-yellow-300 bg-yellow-50 text-yellow-600'
                          : 'border-[var(--yr-line)] text-gray-400 hover:border-[var(--yr-line-strong)] hover:text-gray-600'
                      }`}
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
                </div>
                {isEditing && (
                  <div className="mt-1">
                    <textarea
                      aria-label={`Note for ${program.title}`}
                      value={note}
                      onChange={(event) => {
                        const value = event.target.value;
                        setNotes((current) => ({ ...current, [program.id]: value }));
                        scheduleNoteSave(program.id, value);
                      }}
                      onBlur={() => flushNoteSave(program.id)}
                      maxLength={MAX_PROGRAM_NOTE_LENGTH}
                      placeholder="Add a private note about this program..."
                      rows={2}
                      className="w-full rounded-md border border-[var(--yr-line)] px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <p
                      className={`mt-1 text-xs ${status === 'error' ? 'text-red-700' : 'text-gray-500'}`}
                      role={status === 'error' ? 'alert' : 'status'}
                      aria-live="polite"
                    >
                      {status === 'saving'
                        ? 'Saving...'
                        : status === 'saved'
                          ? 'Saved'
                          : status === 'error'
                            ? 'Not saved. Check your connection or sign in again, then retry.'
                            : ''}
                    </p>
                  </div>
                )}
                {!isEditing && note && (
                  <p className="ml-1 mt-0.5 truncate text-xs italic text-gray-500">Note: {note}</p>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="rounded-md border border-dashed border-[var(--yr-line-strong)] bg-[var(--yr-panel-muted)] p-5 text-center">
          <h3 className="text-base font-semibold text-gray-950">No watched programs yet</h3>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-gray-600">
            When a program or fellowship looks like a possible fit, watch it here to keep its
            deadline, accepting status, and eligibility close at hand.
          </p>
          <Link
            to="/programs"
            className="mt-4 inline-flex min-h-[44px] items-center rounded-md bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
          >
            Programs & Fellowships
          </Link>
        </div>
      )}

      {selectedProgram && (
        <FellowshipModal
          fellowship={selectedProgram}
          isOpen={isModalOpen}
          onClose={closeModal}
          isFavorite={watchedIds.includes(selectedProgram.id)}
          toggleFavorite={() => toggleFavorite(selectedProgram.id)}
        />
      )}
    </section>
  );
};

export default ProgramWatch;
