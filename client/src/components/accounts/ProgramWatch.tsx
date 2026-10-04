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
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { formatProgramCalendarDate } from '../../utils/programDates';
import BrowseListItem from '../shared/BrowseListItem';
import FellowshipModal from '../fellowship/FellowshipModal';
import LoadingSpinner from '../shared/LoadingSpinner';
import LoadErrorNotice from '../shared/LoadErrorNotice';
import useFavorites from '../../hooks/useFavorites';
import useLatestRequest from '../../hooks/useLatestRequest';
import usePlanNoteAutosave from '../../hooks/usePlanNoteAutosave';
import useUndoableProgramUnwatch, {
  undoRestoresSummary,
  watchedProgramPlanSnapshot,
} from '../../hooks/useUndoableProgramUnwatch';
import UndoRemovalBanner from '../shared/UndoRemovalBanner';
import axios from '../../utils/axios';
import ResearchPlanStageControl from './ResearchPlanStageControl';
import {
  createResearchAnalyticsInteractionId,
  trackResearchEvent,
} from '../../utils/researchAnalytics';
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
import { CalendarIcon, EditIcon } from '../shared/icons';
import useLoadEffect from '../../hooks/useLoadEffect';

interface ProgramWatchProps {
  onSummaryChange?: (summary: {
    count: number | null;
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
    nextDeadlineLabel: `${prefix}${formatProgramCalendarDate(next.date)}`,
  };
};

const persistProgramNote = async (programId: string, note: string) => {
  try {
    await axios.put(`/users/watchedProgramPlans/${programId}`, {
      data: { plan: { privateNotes: note } },
    });
  } catch (error) {
    console.error('Error saving watched program plan.');
    throw error;
  }
  void trackResearchEvent({
    eventType: 'research_plan_update',
    entityType: 'fellowship',
    entityId: programId,
    payload: { field: 'note_presence' },
    dedupeKey: createResearchAnalyticsInteractionId('plan'),
  });
};

const ProgramWatch = ({ onSummaryChange }: ProgramWatchProps) => {
  const {
    favIds: watchedIds,
    loaded: watchedIdsLoaded,
    loadError: watchedIdsLoadFailed,
    setFavorite,
    reloadFavorites,
  } = useFavorites('watchedPrograms', { surface: 'saved_plans' });
  const [programs, setPrograms] = useState<Fellowship[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [stages, setStages] = useState<Record<string, ResearchPlanStage>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [programsLoadFailed, setProgramsLoadFailed] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [stageStatuses, setStageStatuses] = useState<Record<string, SaveStatus>>({});
  const [selectedProgram, setSelectedProgram] = useState<Fellowship | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { noteSaveStatuses, saveNote, scheduleNoteSave, cancelNoteSave, markNotePersisted } =
    usePlanNoteAutosave(persistProgramNote);
  const { unwatchedProgram, unwatchProgram, undoUnwatch, restartUndoWindow } =
    useUndoableProgramUnwatch({
      setFavorite,
      surface: 'saved_plans',
      onPlanRestored: (programId, plan) => markNotePersisted(programId, plan.privateNotes),
    });

  const programRequest = useLatestRequest();

  const loadPrograms = useCallback(async () => {
    const ticket = programRequest.begin();
    setIsLoading(true);
    setProgramsLoadFailed(false);
    try {
      const [programResponse, planResponse] = await Promise.all([
        axios.get('/users/watchedPrograms', { withCredentials: true, signal: ticket.signal }),
        axios.get('/users/watchedProgramPlans', { withCredentials: true, signal: ticket.signal }),
      ]);
      if (!ticket.isCurrent()) return;
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
        markNotePersisted(program.id, loadedNotes[program.id]);
      }
      setPrograms(loadedPrograms);
      setNotes(loadedNotes);
      setStages(loadedStages);
    } catch {
      if (!ticket.isCurrent()) return;
      console.error('Error fetching watched programs.');
      setPrograms([]);
      setNotes({});
      setStages({});
      setProgramsLoadFailed(true);
    } finally {
      if (ticket.isCurrent()) setIsLoading(false);
    }
  }, [programRequest, markNotePersisted]);

  useLoadEffect(loadPrograms);

  const retryLoad = () => {
    void reloadFavorites();
    void loadPrograms();
  };

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

  const watchedCount = !watchedIdsLoaded
    ? null
    : isLoading || programsLoadFailed
      ? watchedIds.length
      : visiblePrograms.length;

  useEffect(() => {
    onSummaryChange?.({
      count: watchedCount,
      approachingCount: deadlineUrgency.approachingCount,
      notStartedCount: deadlineUrgency.notStartedCount,
      ...nextDeadline,
    });
  }, [watchedCount, nextDeadline, deadlineUrgency, onSummaryChange]);

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

  const stopWatching = (program: Fellowship) => {
    cancelNoteSave(program.id);
    const removal = unwatchProgram(
      program,
      watchedProgramPlanSnapshot({ privateNotes: notes[program.id], stage: stages[program.id] }),
    );
    void removal.then((removed) => {
      if (removed) markNotePersisted(program.id, '');
    });
  };

  const toggleWatch = (program: Fellowship) => {
    if (watchedIds.includes(program.id)) stopWatching(program);
    else void setFavorite(program.id, true);
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
        void trackResearchEvent({
          eventType: 'research_plan_update',
          entityType: 'fellowship',
          entityId: programId,
          payload: { field: 'stage' },
          dedupeKey: createResearchAnalyticsInteractionId('plan'),
        });
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
    restartUndoWindow();
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
          <h2 className="yr-display text-2xl font-semibold text-ink">Program watch</h2>
          <p className="mt-1 text-sm text-muted">
            Programs and fellowships you are watching, with their deadlines, accepting status, and
            eligibility. Open one to see its details, or unwatch it.
          </p>
        </div>
        {upcomingDeadlineEventsByProgramId.size > 0 && (
          <button
            type="button"
            onClick={addAllDeadlinesToCalendar}
            className="inline-flex min-h-[44px] items-center rounded-control border border-[var(--yr-line)] px-3 py-2 text-sm font-semibold text-ink-soft hover:border-[var(--yr-line-strong)] hover:text-ink yr-focus-ring"
          >
            Add all deadlines to calendar
          </button>
        )}
      </div>

      {unwatchedProgram && (
        <UndoRemovalBanner onUndo={() => void undoUnwatch()}>
          Stopped watching <span className="font-semibold text-ink">{unwatchedProgram.title}</span>.
          {undoRestoresSummary(unwatchedProgram.plan)}
        </UndoRemovalBanner>
      )}

      {programsLoadFailed || watchedIdsLoadFailed ? (
        <LoadErrorNotice
          title="Could not load your watched programs"
          detail="This is a loading problem, not an empty list. Check your connection, then try again."
          onRetry={retryLoad}
        />
      ) : visiblePrograms.length > 0 ? (
        <ul>
          {visiblePrograms.map((program) => {
            const status = noteSaveStatuses[program.id];
            const isEditing = editingId === program.id;
            const note = notes[program.id] || '';
            const stage = stages[program.id] || DEFAULT_RESEARCH_PLAN_STAGE;
            return (
              <li key={program.id} className="mb-2">
                <BrowseListItem
                  item={fellowshipToBrowsable(program)}
                  isFavorite={watchedIds.includes(program.id)}
                  onToggleFavorite={(event) => {
                    event.stopPropagation();
                    toggleWatch(program);
                  }}
                  onOpenModal={() => openModal(program)}
                  footer={
                    <>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                          <span className="text-xs font-medium text-muted">Outreach stage</span>
                          <ResearchPlanStageControl
                            stage={stage}
                            onChange={(nextStage) => void changeStage(program.id, nextStage)}
                            controlLabel={`Outreach stage for ${program.title}`}
                            status={stageStatuses[program.id]}
                          />
                        </div>
                        <div className="flex flex-row gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              setEditingId((current) =>
                                current === program.id ? null : program.id,
                              )
                            }
                            aria-expanded={isEditing}
                            aria-label={
                              isEditing
                                ? `Hide note for ${program.title}`
                                : `Add note for ${program.title}`
                            }
                            title={isEditing ? 'Hide note' : 'Add note'}
                            className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-control border p-2 transition-colors yr-focus-ring ${
                              note
                                ? 'border-gold bg-gold-soft text-ink-soft hover:bg-[var(--yr-parchment)]'
                                : 'border-[var(--yr-line)] text-muted hover:border-[var(--yr-line-strong)] hover:text-ink-soft'
                            }`}
                          >
                            <EditIcon size={16} />
                          </button>
                          {upcomingDeadlineEventsByProgramId.has(program.id) && (
                            <button
                              type="button"
                              onClick={() => addProgramDeadlineToCalendar(program)}
                              aria-label={`Add ${program.title} deadline to calendar`}
                              title="Add deadline to calendar"
                              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-control border border-[var(--yr-line)] p-2 text-muted transition-colors hover:border-[var(--yr-line-strong)] hover:text-ink-soft yr-focus-ring"
                            >
                              <CalendarIcon size={16} />
                            </button>
                          )}
                        </div>
                      </div>
                      {isEditing && (
                        <div className="mt-2">
                          <textarea
                            aria-label={`Note for ${program.title}`}
                            value={note}
                            onChange={(event) => {
                              const value = event.target.value;
                              setNotes((current) => ({ ...current, [program.id]: value }));
                              scheduleNoteSave(program.id, value);
                            }}
                            onBlur={() => void saveNote(program.id, note)}
                            maxLength={MAX_PROGRAM_NOTE_LENGTH}
                            placeholder="Add a private note about this program…"
                            rows={2}
                            className="w-full rounded-control border border-[var(--yr-line-control)] px-3 py-2 text-base yr-focus-ring focus:border-[var(--yr-blue)]"
                          />
                          <p
                            className={`mt-1 text-xs ${status === 'error' ? 'text-red-700' : 'text-muted'}`}
                            role={status === 'error' ? 'alert' : 'status'}
                            aria-live="polite"
                          >
                            {status === 'saving'
                              ? 'Saving…'
                              : status === 'saved'
                                ? 'Saved'
                                : status === 'error'
                                  ? 'Not saved. Check your connection or sign in again, then retry.'
                                  : ''}
                          </p>
                        </div>
                      )}
                      {!isEditing && note && (
                        <p className="mt-2 truncate text-xs italic text-muted">Note: {note}</p>
                      )}
                    </>
                  }
                />
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="rounded-card border border-dashed border-[var(--yr-line-strong)] bg-[var(--yr-panel-muted)] p-5 text-center">
          <h3 className="text-base font-semibold text-ink">No watched programs yet</h3>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-muted">
            When a program or fellowship looks like a possible fit, watch it here to keep its
            deadline, accepting status, and eligibility close at hand.
          </p>
          <Link
            to="/programs"
            className="yr-pressable mt-4 inline-flex min-h-[44px] items-center rounded-control bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-navy yr-focus-ring"
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
          toggleFavorite={() => toggleWatch(selectedProgram)}
        />
      )}
    </section>
  );
};

export default ProgramWatch;
