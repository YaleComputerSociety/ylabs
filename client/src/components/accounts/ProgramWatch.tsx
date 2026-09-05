/**
 * Program Watch surface for the account page.
 *
 * Lists the programs and fellowships an account is watching, backed by the
 * canonical ResearchPlan PROGRAM targets (served by /users/watchedPrograms and
 * /users/watchedProgramPlans). Each watched program keeps its at-a-glance info
 * (deadline, accepting status, eligibility), a link to the program, a private
 * note, an outreach-stage control across the full ResearchPlan pipeline, and an
 * unwatch control. Watching is a personal bookmark; program content stays
 * read-only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Fellowship } from '../../types/types';
import { BrowsableItem } from '../../types/browsable';
import { createFellowship } from '../../utils/createFellowship';
import {
  buildProgramDeadlinesIcsCalendar,
  downloadIcsCalendar,
  fellowshipFutureDeadlineDate,
  icsFilenameForProgram,
  upcomingProgramDeadlineEvents,
} from '../../utils/calendarExport';
import BrowseListItem from '../shared/BrowseListItem';
import FellowshipModal from '../fellowship/FellowshipModal';
import LoadingSpinner from '../shared/LoadingSpinner';
import useFavorites from '../../hooks/useFavorites';
import axios from '../../utils/axios';
import ResearchPlanStageControl from './ResearchPlanStageControl';
import {
  DEFAULT_RESEARCH_PLAN_STAGE,
  normalizeResearchPlanStage,
  type ResearchPlanStage,
} from '../../utils/researchPlanStages';
import {
  sortByUpcomingDeadline,
  summarizeWatchedDeadlines,
  type WatchedProgramWithStage,
} from '../../utils/watchedDeadlineSummary';

interface ProgramWatchProps {
  onSummaryChange?: (summary: {
    count: number;
    nextDeadlineLabel?: string;
    nextDeadlineDate?: string;
    approachingCount?: number;
    notStartedCount?: number;
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

export const watchedProgramDeadlineSummary = (
  fellowships: Fellowship[],
  now = new Date(),
): { nextDeadlineDate?: string; nextDeadlineLabel?: string } => {
  const upcoming = fellowships
    .map((fellowship) => {
      const date = fellowshipFutureDeadlineDate(fellowship, now);
      if (!date) return null;
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
  const [stages, setStages] = useState<Record<string, ResearchPlanStage>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saveStatuses, setSaveStatuses] = useState<Record<string, SaveStatus>>({});
  const [stageStatuses, setStageStatuses] = useState<Record<string, SaveStatus>>({});
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
        const loadedStages: Record<string, ResearchPlanStage> = {};
        for (const program of loadedPrograms) {
          loadedNotes[program.id] = plans[program.id]?.privateNotes || '';
          loadedStages[program.id] = normalizeResearchPlanStage(plans[program.id]?.stage);
        }
        setPrograms(loadedPrograms);
        setNotes(loadedNotes);
        setStages(loadedStages);
      } catch {
        if (!active) return;
        console.error('Error fetching watched programs.');
        setPrograms([]);
        setNotes({});
        setStages({});
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
    () => sortByUpcomingDeadline(programs.filter((program) => watchedIds.includes(program.id))),
    [programs, watchedIds],
  );

  const nextDeadline = useMemo(
    () => watchedProgramDeadlineSummary(visiblePrograms),
    [visiblePrograms],
  );

  const deadlineUrgency = useMemo(() => {
    const watched: WatchedProgramWithStage[] = visiblePrograms.map((program) => ({
      program,
      stage: stages[program.id],
    }));
    return summarizeWatchedDeadlines(watched);
  }, [visiblePrograms, stages]);

  useEffect(() => {
    onSummaryChange?.({
      count: visiblePrograms.length,
      approachingCount: deadlineUrgency.approachingCount,
      notStartedCount: deadlineUrgency.notStartedCount,
      ...nextDeadline,
    });
  }, [visiblePrograms.length, nextDeadline, deadlineUrgency, onSummaryChange]);

  const upcomingDeadlineEventsByProgramId = useMemo(() => {
    const events = upcomingProgramDeadlineEvents(visiblePrograms);
    return new Map(events.map((event) => [event.programId, event]));
  }, [visiblePrograms]);

  const addProgramDeadlineToCalendar = (program: Fellowship) => {
    const event = upcomingDeadlineEventsByProgramId.get(program.id);
    if (!event) return;
    downloadIcsCalendar(
      icsFilenameForProgram(program.title),
      buildProgramDeadlinesIcsCalendar([event]),
    );
  };

  const addAllDeadlinesToCalendar = () => {
    const events = Array.from(upcomingDeadlineEventsByProgramId.values());
    if (events.length === 0) return;
    downloadIcsCalendar('program-watch-deadlines.ics', buildProgramDeadlinesIcsCalendar(events));
  };

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

  const changeStage = useCallback(
    async (programId: string, nextStage: ResearchPlanStage) => {
      const previousStage = stages[programId] || DEFAULT_RESEARCH_PLAN_STAGE;
      if (previousStage === nextStage) return;
      setStages((current) => ({ ...current, [programId]: nextStage }));
      setStageStatuses((statuses) => ({ ...statuses, [programId]: 'saving' }));
      try {
        await axios.put(`/users/watchedProgramPlans/${programId}`, {
          data: { plan: { stage: nextStage } },
        });
        setStageStatuses((statuses) => ({ ...statuses, [programId]: 'saved' }));
      } catch {
        console.error('Error saving watched program stage.');
        setStages((current) => ({ ...current, [programId]: previousStage }));
        setStageStatuses((statuses) => ({ ...statuses, [programId]: 'error' }));
      }
    },
    [stages],
  );

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
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Program watch</h2>
          <p className="mt-1 text-sm text-gray-500">
            Programs and fellowships you are watching, with their deadlines, accepting status, and
            eligibility. Open one to see its details, or unwatch it.
          </p>
        </div>
        {upcomingDeadlineEventsByProgramId.size > 0 && (
          <button
            type="button"
            onClick={addAllDeadlinesToCalendar}
            className="inline-flex min-h-[44px] items-center rounded-md border border-[var(--yr-line)] px-3 py-2 text-sm font-semibold text-gray-700 hover:border-[var(--yr-line-strong)] hover:text-gray-900"
          >
            Add all deadlines to calendar
          </button>
        )}
      </div>

      {visiblePrograms.length > 0 ? (
        <ul>
          {visiblePrograms.map((program) => {
            const status = saveStatuses[program.id];
            const isEditing = editingId === program.id;
            const note = notes[program.id] || '';
            const stage = stages[program.id] || DEFAULT_RESEARCH_PLAN_STAGE;
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
                      onClick={() =>
                        setEditingId((current) => (current === program.id ? null : program.id))
                      }
                      aria-expanded={isEditing}
                      aria-label={
                        isEditing
                          ? `Hide note for ${program.title}`
                          : `Add note for ${program.title}`
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
                    {upcomingDeadlineEventsByProgramId.has(program.id) && (
                      <button
                        type="button"
                        onClick={() => addProgramDeadlineToCalendar(program)}
                        aria-label={`Add ${program.title} deadline to calendar`}
                        title="Add deadline to calendar"
                        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded border border-[var(--yr-line)] p-2 text-gray-400 transition-colors hover:border-[var(--yr-line-strong)] hover:text-gray-600"
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
                          <rect x="3" y="4" width="18" height="18" rx="2" />
                          <path d="M16 2v4M8 2v4M3 10h18" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-1 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                  <span className="ml-1 text-xs font-medium text-gray-600">Outreach stage</span>
                  <ResearchPlanStageControl
                    stage={stage}
                    onChange={(nextStage) => void changeStage(program.id, nextStage)}
                    controlLabel={`Outreach stage for ${program.title}`}
                    status={stageStatuses[program.id]}
                  />
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
                      className="w-full rounded-md border border-[var(--yr-line)] px-3 py-2 text-sm yr-focus-ring focus:border-[var(--yr-blue)]"
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
            className="mt-4 inline-flex min-h-[44px] items-center rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft"
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
