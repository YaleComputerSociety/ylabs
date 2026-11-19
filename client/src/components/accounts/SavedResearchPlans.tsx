/**
 * Account dashboard workspace for saved research plans.
 *
 * Renders the student's saved research (canonical ResearchPlan, served by
 * /users/savedResearchEntities and /users/savedResearchEntityPlans) so a saved
 * plan can be opened, annotated, and removed rather than only counted.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from '../../utils/axios';
import useFavorites from '../../hooks/useFavorites';
import useLatestRequest from '../../hooks/useLatestRequest';
import usePlanNoteAutosave, { type PersistNoteOptions } from '../../hooks/usePlanNoteAutosave';
import { keepalivePut } from '../../utils/keepalivePut';
import PlanNoteSaveStatusText from './PlanNoteSaveStatusText';
import useUndoableRemoval from '../../hooks/useUndoableRemoval';
import UndoRemovalBanner from '../shared/UndoRemovalBanner';
import LoadingSpinner from '../shared/LoadingSpinner';
import LoadErrorNotice from '../shared/LoadErrorNotice';
import { safeRouteSegment } from '../../utils/url';
import {
  deriveUndergraduateAccessStatuses,
  undergraduateAccessSortRank,
  type UndergraduateAccessFields,
  type UndergraduateAccessStatus,
} from '../../utils/undergraduateAccessStatus';
import ResearchHomeComparison from './ResearchHomeComparison';
import { entityKindLabel, researchEntityTitle } from '../../utils/researchEntityCopy';
import ResearchPlanStageControl from './ResearchPlanStageControl';
import {
  createResearchAnalyticsInteractionId,
  researchProfileOpenState,
  trackResearchEvent,
} from '../../utils/researchAnalytics';
import {
  DEFAULT_RESEARCH_PLAN_STAGE,
  isActiveResearchPlanStage,
  normalizeResearchPlanStage,
  type ResearchPlanStage,
} from '../../utils/researchPlanStages';
import useLoadEffect from '../../hooks/useLoadEffect';
import PlanListControls, { PlanFilterEmptyState } from './PlanListControls';
import {
  DEFAULT_PLAN_LIST_VIEW,
  compareNewestSavedFirst,
  compareStageOrder,
  countPlansByStage,
  orderStably,
  planMatchesStageFilter,
  type PlanListView,
  type PlanStageFilter,
} from '../../utils/dashboardPlanListView';
import usePlanDetailSync, {
  isPlanVersionConflict,
  type ServedPlanDetail,
  type ServedPlans,
} from '../../hooks/usePlanDetailSync';

interface SavedResearchPlansProps {
  onCountChange?: (count: number | null) => void;
  listView?: PlanListView;
  onListViewChange?: (view: PlanListView) => void;
}

const PLAN_LIST_ID = 'saved-research-plans';
const PLAN_LIST_NOUN = 'saved research plans';

interface SavedResearchEntity extends UndergraduateAccessFields {
  _id: string;
  slug: string;
  name: string;
  displayName?: string;
  kind?: string;
  entityType?: string;
  creativePractice?: boolean;
  departments?: string[];
  school?: string;
  shortDescription?: string;
}

/**
 * A saved plan the list cannot show, reported by the server rather than dropped, so
 * a student can tell an entry they removed from one the corpus stopped
 * serving (#2174). `RETIRED` is terminal; `UNAVAILABLE` can be reversed by a repair
 * or a re-gate, so its plan and private notes are worth keeping.
 */
interface UnavailableSavedResearchEntity {
  _id: string;
  reason: 'UNAVAILABLE' | 'MERGED' | 'RETIRED';
}

/**
 * Neither line claims the entry cannot be opened, because the gate behind
 * these reasons is name-agnostic while the detail page resolves lead names, so a
 * held row can still serve its own page (#2597). What is true of every row here is
 * that the student directory is not listing it, which is what the copy says.
 * `RETIRED` promises nothing about the note: the plan row survives until removal,
 * but with the target gone no surface can ever read the note back.
 */
const UNAVAILABLE_REASON_TEXT: Record<UnavailableSavedResearchEntity['reason'], string> = {
  MERGED:
    'Combined with another listing for the same research. Your note moves to that listing at the next directory update.',
  RETIRED: 'No longer listed in the student directory. Remove it to clear this item.',
  UNAVAILABLE:
    'Held back from the student directory right now. Your note is kept, and this item will reappear here once the directory lists it again.',
};

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

type ListLoadMode = 'replace' | 'merge';

const MAX_PLAN_NOTES_LENGTH = 2000;
const MIN_COMPARE_ENTITIES = 2;
const MAX_COMPARE_ENTITIES = 4;

const entityDisplayName = (entity: SavedResearchEntity): string => researchEntityTitle(entity);

const noteButtonVerb = (isEditing: boolean, note: string): string =>
  isEditing ? 'Hide note' : note ? 'Edit note' : 'Add note';

const entitySubtitle = (entity: SavedResearchEntity): string => {
  const departments = (entity.departments || []).filter(Boolean);
  const parts = [departments[0], entity.school].filter((part): part is string =>
    Boolean(part && part.trim()),
  );
  return parts.join(' · ');
};

const ACCESS_BADGE_CLASS: Record<UndergraduateAccessStatus['tone'], string> = {
  invitation: 'border-[var(--yr-green)] bg-[var(--yr-green-soft)] text-[var(--yr-green)]',
  evidence: 'border-blue-200 bg-[var(--yr-blue-soft)] text-[var(--yr-blue)]',
};

const NO_ACCESS_STATUSES: UndergraduateAccessStatus[] = [];

const SavedResearchPlans = ({
  onCountChange,
  listView = DEFAULT_PLAN_LIST_VIEW,
  onListViewChange,
}: SavedResearchPlansProps) => {
  const {
    favIds: savedSlugs,
    loaded: savedSlugsLoaded,
    loadError: savedSlugsLoadFailed,
    setFavorite,
    reloadFavorites,
  } = useFavorites('researchPlans');
  const [entities, setEntities] = useState<SavedResearchEntity[]>([]);
  const [unavailable, setUnavailable] = useState<UnavailableSavedResearchEntity[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [stages, setStages] = useState<Record<string, ResearchPlanStage>>({});
  const [savedAt, setSavedAt] = useState<Record<string, string | undefined>>({});
  const [keptInView, setKeptInView] = useState<{ filter: PlanStageFilter; ids: string[] }>({
    filter: DEFAULT_PLAN_LIST_VIEW.stageFilter,
    ids: [],
  });
  const [isLoading, setIsLoading] = useState(true);
  const [plansLoadFailed, setPlansLoadFailed] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [stageStatuses, setStageStatuses] = useState<Record<string, SaveStatus>>({});
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);
  const [isComparing, setIsComparing] = useState(false);
  const planSyncRef = useRef<ReturnType<typeof usePlanDetailSync> | null>(null);
  const persistResearchPlanNote = useCallback(
    async (entityId: string, note: string, options?: PersistNoteOptions) => {
      const sync = planSyncRef.current;
      const send = async (version: string | undefined) => {
        const body = {
          data: {
            plan: { privateNotes: note, ...(version ? { expectedUpdatedAt: version } : {}) },
          },
        };
        const served = options?.keepalive
          ? await keepalivePut(`/users/savedResearchEntityPlans/${entityId}`, body)
          : (await axios.put(`/users/savedResearchEntityPlans/${entityId}`, body)).data;
        return (served as { savedResearchEntityPlans?: ServedPlans } | undefined)
          ?.savedResearchEntityPlans;
      };
      try {
        await (sync
          ? sync.writePlan(entityId, send, { immediate: options?.keepalive })
          : send(undefined));
      } catch (error) {
        console.error('Error saving research plan note.');
        if (isPlanVersionConflict(error))
          void sync?.refreshPlanDetails({ adoptVersionOf: entityId });
        throw error;
      }
      void trackResearchEvent({
        eventType: 'research_plan_update',
        entityType: 'research_entity',
        entityId: entityId,
        payload: { field: 'note_presence' },
        dedupeKey: createResearchAnalyticsInteractionId('plan'),
      });
    },
    [],
  );
  const {
    noteSaveStatuses,
    saveNote,
    scheduleNoteSave,
    cancelNoteSave,
    retainNoteSaves,
    markNotePersisted,
  } = usePlanNoteAutosave(persistResearchPlanNote);

  const planSync = usePlanDetailSync({
    plansPath: '/users/savedResearchEntityPlans',
    responseKey: 'savedResearchEntityPlans',
    notes,
    stages,
    setNotes,
    setStages,
    markNotePersisted,
  });
  const { recordServedPlan, writePlan, refreshPlanDetails, takeServerStage } = planSync;
  useEffect(() => {
    planSyncRef.current = planSync;
  });

  // The count is how many plans the owner has, not how many of them are servable:
  // reporting only the servable ones is what let the dashboard read "0 research
  // plans" beside a notice about a saved item it was holding back (#2174).
  useEffect(() => {
    onCountChange?.(savedSlugsLoaded ? savedSlugs.length + unavailable.length : null);
  }, [savedSlugsLoaded, savedSlugs.length, unavailable.length, onCountChange]);

  const planRequest = useLatestRequest();

  const loadedIdsRef = useRef(new Set<string>());

  const loadPlans = useCallback(
    async (mode: ListLoadMode = 'replace'): Promise<boolean> => {
      const ticket = planRequest.begin();
      const merging = mode === 'merge';
      if (!merging) {
        setIsLoading(true);
        setPlansLoadFailed(false);
      }
      try {
        const [entityResponse, planResponse] = await Promise.all([
          axios.get('/users/savedResearchEntities', {
            withCredentials: true,
            signal: ticket.signal,
          }),
          axios.get('/users/savedResearchEntityPlans', {
            withCredentials: true,
            signal: ticket.signal,
          }),
        ]);
        if (!ticket.isCurrent()) return false;
        const loadedEntities: SavedResearchEntity[] =
          entityResponse.data.savedResearchEntities || [];
        const loadedUnavailable: UnavailableSavedResearchEntity[] =
          entityResponse.data.unavailableSavedResearchEntities || [];
        const plans = (planResponse.data.savedResearchEntityPlans || {}) as Record<
          string,
          ServedPlanDetail
        >;
        const loadedNotes: Record<string, string> = {};
        const loadedStages: Record<string, ResearchPlanStage> = {};
        const loadedSavedAt: Record<string, string | undefined> = {};
        for (const entity of loadedEntities) {
          loadedSavedAt[entity._id] = plans[entity._id]?.createdAt;
          if (merging && loadedIdsRef.current.has(entity._id)) continue;
          loadedNotes[entity._id] = plans[entity._id]?.privateNotes || '';
          loadedStages[entity._id] = normalizeResearchPlanStage(plans[entity._id]?.stage);
          markNotePersisted(entity._id, loadedNotes[entity._id]);
          recordServedPlan(entity._id, plans[entity._id]);
        }
        loadedIdsRef.current = new Set([
          ...(merging ? loadedIdsRef.current : []),
          ...loadedEntities.map((entity) => entity._id),
        ]);
        setEntities(loadedEntities);
        setUnavailable(loadedUnavailable);
        setNotes((current) => (merging ? { ...loadedNotes, ...current } : loadedNotes));
        setStages((current) => (merging ? { ...loadedStages, ...current } : loadedStages));
        setSavedAt(loadedSavedAt);
        return true;
      } catch {
        if (!ticket.isCurrent() || merging) return false;
        console.error('Error fetching saved research plans.');
        setEntities([]);
        setUnavailable([]);
        setNotes({});
        setStages({});
        setSavedAt({});
        setPlansLoadFailed(true);
        return false;
      } finally {
        if (ticket.isCurrent()) setIsLoading(false);
      }
    },
    [planRequest, markNotePersisted, recordServedPlan],
  );

  useLoadEffect(loadPlans);

  useEffect(() => {
    if (savedSlugsLoaded) void refreshPlanDetails();
  }, [savedSlugs, savedSlugsLoaded, refreshPlanDetails]);

  const requestedSaveIdsRef = useRef(new Set<string>());
  useEffect(() => {
    if (isLoading || plansLoadFailed || !savedSlugsLoaded) return;
    const known = new Set([
      ...entities.flatMap((entity) => [entity.slug, entity._id]),
      ...unavailable.map((entry) => entry._id),
      ...requestedSaveIdsRef.current,
    ]);
    const unseen = savedSlugs.filter((id) => !known.has(id));
    if (unseen.length === 0) return;
    unseen.forEach((id) => requestedSaveIdsRef.current.add(id));
    void loadPlans('merge').then((merged) => {
      if (!merged) unseen.forEach((id) => requestedSaveIdsRef.current.delete(id));
    });
  }, [isLoading, plansLoadFailed, savedSlugsLoaded, entities, unavailable, savedSlugs, loadPlans]);

  const retryLoad = () => {
    void reloadFavorites();
    void loadPlans();
  };

  const changeStage = useCallback(
    async (entityId: string, nextStage: ResearchPlanStage) => {
      const previousStage = stages[entityId] || DEFAULT_RESEARCH_PLAN_STAGE;
      if (previousStage === nextStage) return;
      setKeptInView((current) =>
        current.filter === listView.stageFilter
          ? { filter: current.filter, ids: [...current.ids, entityId] }
          : { filter: listView.stageFilter, ids: [entityId] },
      );
      setStages((current) => ({ ...current, [entityId]: nextStage }));
      setStageStatuses((statuses) => ({ ...statuses, [entityId]: 'saving' }));
      try {
        await writePlan(entityId, async (version) => {
          const response = await axios.put(`/users/savedResearchEntityPlans/${entityId}`, {
            data: {
              plan: { stage: nextStage, ...(version ? { expectedUpdatedAt: version } : {}) },
            },
          });
          return response.data?.savedResearchEntityPlans;
        });
        setStageStatuses((statuses) => ({ ...statuses, [entityId]: 'saved' }));
        void trackResearchEvent({
          eventType: 'research_plan_update',
          entityType: 'research_entity',
          entityId,
          payload: { field: 'stage' },
          dedupeKey: createResearchAnalyticsInteractionId('plan'),
        });
      } catch (error) {
        console.error('Error saving research plan stage.');
        if (isPlanVersionConflict(error) && (await takeServerStage(entityId))) {
          setStageStatuses((statuses) => ({ ...statuses, [entityId]: 'conflict' }));
          return;
        }
        setStages((current) => ({ ...current, [entityId]: previousStage }));
        setStageStatuses((statuses) => ({ ...statuses, [entityId]: 'error' }));
      }
    },
    [stages, writePlan, takeServerStage, listView.stageFilter],
  );

  /**
   * The server keeps an unsaved plan whole for a restore window, so re-favouriting
   * within it brings back the stage, note, checklist and deadlines (#3643). Undo
   * still re-posts the note captured here, so a restore that lands after the window
   * does not lose the one field this surface holds.
   *
   * An undo window is the right shape rather than a confirmation dialog:
   * Shneiderman's sixth rule is about the reassurance as much as the recovery, and a
   * dialog taxes every removal to guard against the rare regretted one.
   */
  const {
    undoableItem: undoableUnsave,
    offerUndo,
    undoRemoval,
  } = useUndoableRemoval<{ slug: string; entityId: string; name: string; note: string }>();

  const unsavePlan = (slug: string, entityId: string, name: string) => {
    // Read the note before the row leaves the list, because afterwards no read path
    // serves it.
    const note = notes[entityId] || '';
    cancelNoteSave(entityId);
    const removal = setFavorite(slug, false, 'saved_plans');
    void removal.then((removed) => {
      if (removed) markNotePersisted(entityId, '');
    });
    offerUndo({ slug, entityId, name, note }, removal);
  };

  const undoUnsave = () =>
    undoRemoval(async ({ slug, entityId, note }) => {
      const restored = await setFavorite(slug, true, 'saved_plans');
      // The note write is not gated on the favourite succeeding. Gating it means a
      // failed re-favourite outside the server's restore window discards the only copy
      // of the note, which is the loss this undo exists to prevent.
      if (note) {
        await refreshPlanDetails({ adoptVersionOf: entityId });
        setNotes((current) => ({ ...current, [entityId]: note }));
        await saveNote(entityId, note);
      }
      // Put the affordance back rather than stranding the student with no way to retry.
      return restored;
    });

  // Keyed by entity id rather than slug: an unavailable target has no slug the list
  // can trust, and the remove endpoint accepts either.
  const removeUnavailablePlan = async (entityId: string) => {
    if (await setFavorite(entityId, false, 'saved_plans')) {
      setUnavailable((current) => current.filter((item) => item._id !== entityId));
    }
  };

  const visibleEntities = useMemo(
    () => entities.filter((entity) => savedSlugs.includes(entity.slug)),
    [entities, savedSlugs],
  );

  useEffect(() => {
    retainNoteSaves(visibleEntities.map((entity) => entity._id));
  }, [visibleEntities, retainNoteSaves]);

  const accessStatuses = useMemo(() => {
    const statuses = new Map<string, UndergraduateAccessStatus[]>();
    for (const entity of visibleEntities) {
      statuses.set(entity._id, deriveUndergraduateAccessStatuses(entity));
    }
    return statuses;
  }, [visibleEntities]);

  const stageOf = useCallback(
    (entityId: string): ResearchPlanStage => stages[entityId] || DEFAULT_RESEARCH_PLAN_STAGE,
    [stages],
  );

  const orderedEntities = useMemo(
    () =>
      orderStably(visibleEntities, (a, b) =>
        listView.sort === 'stage'
          ? compareStageOrder(stageOf(a._id), stageOf(b._id)) ||
            undergraduateAccessSortRank(accessStatuses.get(a._id) || NO_ACCESS_STATUSES) -
              undergraduateAccessSortRank(accessStatuses.get(b._id) || NO_ACCESS_STATUSES)
          : compareNewestSavedFirst(savedAt[a._id], savedAt[b._id]),
      ),
    [visibleEntities, stageOf, accessStatuses, savedAt, listView.sort],
  );

  const stageCounts = useMemo(
    () =>
      countPlansByStage(
        visibleEntities.map((entity) => stageOf(entity._id)),
        'research',
      ),
    [visibleEntities, stageOf],
  );

  const shownEntities = useMemo(() => {
    const kept = keptInView.filter === listView.stageFilter ? keptInView.ids : [];
    return orderedEntities.filter(
      (entity) =>
        planMatchesStageFilter(stageOf(entity._id), listView.stageFilter, 'research') ||
        kept.includes(entity._id),
    );
  }, [orderedEntities, stageOf, listView.stageFilter, keptInView]);

  const changeListView = (view: PlanListView) => onListViewChange?.(view);

  const selectableIds = useMemo(
    () => new Set(visibleEntities.map((entity) => entity._id)),
    [visibleEntities],
  );

  const shownIds = useMemo(
    () => new Set(shownEntities.map((entity) => entity._id)),
    [shownEntities],
  );

  const selectedEntities = useMemo(
    () => visibleEntities.filter((entity) => selectedForCompare.includes(entity._id)),
    [visibleEntities, selectedForCompare],
  );

  const selectedCount = selectedEntities.length;
  const atCompareLimit = selectedCount >= MAX_COMPARE_ENTITIES;
  const canCompare = selectedCount >= MIN_COMPARE_ENTITIES && selectedCount <= MAX_COMPARE_ENTITIES;

  const toggleCompareSelection = (entityId: string) => {
    setSelectedForCompare((current) => {
      if (current.includes(entityId)) return current.filter((id) => id !== entityId);
      if (!shownIds.has(entityId)) return current;
      const visibleSelectedCount = current.filter((id) => selectableIds.has(id)).length;
      if (visibleSelectedCount >= MAX_COMPARE_ENTITIES) return current;
      return [...current, entityId];
    });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center pt-12">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  const heading = (
    <div className="mb-2">
      <h2 className="yr-display text-2xl font-semibold text-ink">Saved research plans</h2>
      <p className="mt-1 text-sm text-muted">
        Open saved research to find its official profile and reach out, keep private notes, or
        remove it from your plans.
      </p>
    </div>
  );

  if (plansLoadFailed || savedSlugsLoadFailed) {
    return (
      <section className="mb-8">
        {heading}
        <LoadErrorNotice
          title="Could not load your saved research"
          detail="This is a loading problem, not an empty list. Check your connection, then try again."
          onRetry={retryLoad}
        />
      </section>
    );
  }

  return (
    <section className="mb-8">
      {heading}

      {undoableUnsave && (
        <UndoRemovalBanner onUndo={() => void undoUnsave()}>
          Removed <span className="font-semibold text-ink">{undoableUnsave.name}</span> from saved
          research.{undoableUnsave.note ? ' Undo restores your notes too.' : ''}
        </UndoRemovalBanner>
      )}

      {unavailable.length > 0 && (
        <div
          className="mb-4 rounded-card border border-amber-200 bg-amber-50 px-4 py-3"
          role="status"
          aria-live="polite"
        >
          <h3 className="text-sm font-semibold text-amber-900">
            {unavailable.length === 1
              ? '1 saved item is not showing below'
              : `${unavailable.length} saved items are not showing below`}
          </h3>
          <ul className="mt-2 space-y-2">
            {unavailable.map((item, index) => {
              const ordinal = unavailable.length > 1 ? `Saved item ${index + 1}` : null;
              return (
                <li
                  key={item._id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1"
                >
                  <p className="text-sm text-amber-900">
                    {ordinal && <span className="font-semibold">{ordinal}: </span>}
                    {UNAVAILABLE_REASON_TEXT[item.reason]}
                  </p>
                  <button
                    type="button"
                    onClick={() => void removeUnavailablePlan(item._id)}
                    aria-label={
                      ordinal ? `Remove ${ordinal.toLowerCase()} from my plans` : undefined
                    }
                    className="inline-flex min-h-[44px] items-center text-sm font-medium text-amber-900 underline hover:text-amber-950 yr-focus-ring"
                  >
                    Remove from my plans
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {visibleEntities.length >= MIN_COMPARE_ENTITIES && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-[var(--yr-line)] bg-[var(--yr-panel-muted)] px-4 py-3">
          <p className="text-sm text-ink-soft">
            {selectedCount === 0
              ? 'Select 2 to 4 saved research profiles to compare them side by side.'
              : `${selectedCount} selected to compare`}
          </p>
          <button
            type="button"
            onClick={() => setIsComparing(true)}
            disabled={!canCompare}
            className="inline-flex min-h-[44px] items-center rounded-control bg-brand px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-navy yr-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            Compare{selectedCount > 0 ? ` (${selectedCount})` : ''}
          </button>
          {selectedCount === 1 && (
            <span className="text-xs text-muted">Select at least 2 to compare.</span>
          )}
          {atCompareLimit && (
            <span className="text-xs text-muted">You can compare up to 4 at once.</span>
          )}
          {selectedCount > 0 && (
            <button
              type="button"
              onClick={() => setSelectedForCompare([])}
              className="text-xs font-medium text-muted underline hover:text-ink yr-focus-ring"
            >
              Clear selection
            </button>
          )}
        </div>
      )}

      {visibleEntities.length > 0 && (
        <PlanListControls
          surface="research"
          idPrefix={PLAN_LIST_ID}
          view={listView}
          counts={stageCounts}
          shownCount={shownEntities.length}
          pluralNoun={PLAN_LIST_NOUN}
          onChange={changeListView}
        />
      )}

      {visibleEntities.length > 0 && shownEntities.length === 0 ? (
        <PlanFilterEmptyState
          idPrefix={PLAN_LIST_ID}
          surface="research"
          stageFilter={listView.stageFilter}
          pluralNoun={PLAN_LIST_NOUN}
          onShowAll={() => changeListView({ ...listView, stageFilter: 'all' })}
        />
      ) : visibleEntities.length > 0 ? (
        <ul>
          {shownEntities.map((entity) => {
            const status = noteSaveStatuses[entity._id];
            const entityAccessStatuses = accessStatuses.get(entity._id) || NO_ACCESS_STATUSES;
            const isEditing = editingId === entity._id;
            const note = notes[entity._id] || '';
            const stage = stageOf(entity._id);
            const isClosed = !isActiveResearchPlanStage(stage);
            return (
              <li key={entity._id} className="mb-2">
                <div
                  className={`rounded-card border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4 ${
                    isClosed ? 'opacity-60' : ''
                  }`}
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      {visibleEntities.length >= MIN_COMPARE_ENTITIES && (
                        <label className="-mx-3 -mb-3.5 -mt-3 inline-flex h-11 w-10 flex-shrink-0 cursor-pointer items-center justify-center has-[:disabled]:cursor-not-allowed">
                          <input
                            type="checkbox"
                            checked={selectedForCompare.includes(entity._id)}
                            disabled={atCompareLimit && !selectedForCompare.includes(entity._id)}
                            onChange={() => toggleCompareSelection(entity._id)}
                            aria-label={`Select ${entityDisplayName(entity)} to compare`}
                            className="h-4 w-4 rounded-control border-line-strong accent-brand yr-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
                          />
                        </label>
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-brand">
                          {entityKindLabel(entity)}
                        </p>
                        <h3 className="truncate text-sm font-semibold text-ink">
                          <Link
                            to={`/research/${safeRouteSegment(entity.slug)}`}
                            state={researchProfileOpenState('saved_plans')}
                            className="hover:text-brand focus-visible:rounded-control yr-focus-ring"
                          >
                            {entityDisplayName(entity)}
                          </Link>
                        </h3>
                        {entitySubtitle(entity) && (
                          <p className="truncate text-xs text-muted">{entitySubtitle(entity)}</p>
                        )}
                        {entityAccessStatuses.length > 0 && (
                          <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {entityAccessStatuses.map((accessStatus) => (
                              <span
                                key={accessStatus.label}
                                className={`inline-flex items-center rounded-card border px-2 py-0.5 text-xs font-semibold ${
                                  ACCESS_BADGE_CLASS[accessStatus.tone]
                                }`}
                              >
                                {accessStatus.label}
                              </span>
                            ))}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setEditingId((current) => (current === entity._id ? null : entity._id))
                        }
                        aria-expanded={isEditing}
                        aria-label={`${noteButtonVerb(isEditing, note)} for ${entityDisplayName(entity)}`}
                        className={`inline-flex min-h-[44px] items-center rounded-control border px-3 py-2 text-xs font-semibold transition-colors yr-focus-ring ${
                          note
                            ? 'border-gold bg-gold-soft text-ink-soft hover:bg-[var(--yr-parchment)]'
                            : 'border-[var(--yr-line)] text-muted hover:bg-[var(--yr-panel-muted)]'
                        }`}
                      >
                        {noteButtonVerb(isEditing, note)}
                      </button>
                      <Link
                        to={`/research/${safeRouteSegment(entity.slug)}`}
                        state={researchProfileOpenState('saved_plans')}
                        className="yr-pressable inline-flex min-h-[44px] items-center rounded-card border border-line-brand bg-brand-soft px-3 py-2 text-xs font-semibold text-brand hover:bg-panel yr-focus-ring"
                      >
                        Open
                      </Link>
                      <button
                        type="button"
                        onClick={() =>
                          unsavePlan(entity.slug, entity._id, entityDisplayName(entity))
                        }
                        aria-label={`Unsave ${entityDisplayName(entity)}`}
                        className="inline-flex min-h-[44px] items-center rounded-control border border-[var(--yr-line)] px-3 py-2 text-xs font-semibold text-muted transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600 yr-focus-ring"
                      >
                        Unsave
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                    <span className="text-xs font-medium text-muted">Outreach stage</span>
                    <ResearchPlanStageControl
                      stage={stage}
                      onChange={(nextStage) => void changeStage(entity._id, nextStage)}
                      controlLabel={`Outreach stage for ${entityDisplayName(entity)}`}
                      status={stageStatuses[entity._id]}
                    />
                  </div>

                  {!isEditing && note && (
                    <p className="mt-2 truncate text-xs italic text-muted">Note: {note}</p>
                  )}

                  {isEditing && (
                    <div className="mt-2">
                      <textarea
                        aria-label={`Note for ${entityDisplayName(entity)}`}
                        value={note}
                        onChange={(event) => {
                          const value = event.target.value;
                          setNotes((current) => ({ ...current, [entity._id]: value }));
                          scheduleNoteSave(entity._id, value);
                        }}
                        onBlur={() => void saveNote(entity._id, note)}
                        maxLength={MAX_PLAN_NOTES_LENGTH}
                        placeholder="Add a private note about this research…"
                        rows={2}
                        className="w-full rounded-control border border-[var(--yr-line-control)] px-3 py-2 text-base yr-focus-ring focus:border-[var(--yr-blue)]"
                      />
                      <PlanNoteSaveStatusText status={status} />
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : unavailable.length === 0 ? (
        <div className="rounded-card border border-dashed border-[var(--yr-line-strong)] bg-[var(--yr-panel-muted)] p-5 text-center">
          <h3 className="text-base font-semibold text-ink">No saved research plans yet</h3>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-muted">
            Save a lab, center, or faculty research profile while browsing and it will show up here
            to open, annotate, and revisit.
          </p>
          <Link
            to="/research"
            className="yr-pressable mt-4 inline-flex min-h-[44px] items-center rounded-control bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-navy yr-focus-ring"
          >
            Explore Research
          </Link>
        </div>
      ) : null}

      {isComparing && canCompare && (
        <ResearchHomeComparison
          entities={selectedEntities}
          notesByEntityId={notes}
          onClose={() => setIsComparing(false)}
        />
      )}
    </section>
  );
};

export default SavedResearchPlans;
