/**
 * Account dashboard workspace for saved research plans.
 *
 * Renders the student's saved research homes (canonical ResearchPlan, served by
 * /users/savedResearchEntities and /users/savedResearchEntityPlans) so a saved
 * plan can be opened, annotated, and removed rather than only counted.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from '../../utils/axios';
import useFavorites from '../../hooks/useFavorites';
import LoadingSpinner from '../shared/LoadingSpinner';
import { safeRouteSegment } from '../../utils/url';
import {
  deriveUndergraduateAccessStatus,
  undergraduateAccessSortRank,
  type UndergraduateAccessStatus,
} from '../../utils/undergraduateAccessStatus';
import ResearchHomeComparison from './ResearchHomeComparison';
import ResearchPlanStageControl from './ResearchPlanStageControl';
import {
  DEFAULT_RESEARCH_PLAN_STAGE,
  isActiveResearchPlanStage,
  normalizeResearchPlanStage,
  researchPlanStageOrder,
  type ResearchPlanStage,
} from '../../utils/researchPlanStages';

interface SavedResearchPlansProps {
  onCountChange?: (count: number) => void;
  onOpenCountChange?: (count: number) => void;
}

interface SavedResearchEntity {
  _id: string;
  slug: string;
  name: string;
  displayName?: string;
  kind?: string;
  departments?: string[];
  school?: string;
  shortDescription?: string;
  undergraduateCurrentAvailability?: string;
  hasUndergradHostingEvidence?: boolean;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const MAX_PLAN_NOTES_LENGTH = 2000;
const MIN_COMPARE_ENTITIES = 2;
const MAX_COMPARE_ENTITIES = 4;

const kindLabel = (kind?: string): string => {
  if (!kind) return 'Research';
  return kind
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

const entityDisplayName = (entity: SavedResearchEntity): string =>
  entity.displayName?.trim() || entity.name;

const entitySubtitle = (entity: SavedResearchEntity): string => {
  const departments = (entity.departments || []).filter(Boolean);
  const parts = [departments[0], entity.school].filter((part): part is string =>
    Boolean(part && part.trim()),
  );
  return parts.join(' · ');
};

const accessBadgeClass = (tone: UndergraduateAccessStatus['tone']): string => {
  switch (tone) {
    case 'open':
      return 'border-emerald-200 bg-emerald-50 text-emerald-800';
    case 'evidence':
      return 'border-blue-200 bg-[var(--yr-blue-soft)] text-[var(--yr-blue)]';
    default:
      return 'border-[var(--yr-line)] bg-[var(--yr-panel-muted)] text-gray-500';
  }
};

const SavedResearchPlans = ({ onCountChange, onOpenCountChange }: SavedResearchPlansProps) => {
  const { favIds: savedSlugs, setFavorite } = useFavorites('researchPlans');
  const [entities, setEntities] = useState<SavedResearchEntity[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [stages, setStages] = useState<Record<string, ResearchPlanStage>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saveStatuses, setSaveStatuses] = useState<Record<string, SaveStatus>>({});
  const [stageStatuses, setStageStatuses] = useState<Record<string, SaveStatus>>({});
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);
  const [isComparing, setIsComparing] = useState(false);
  const noteTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    onCountChange?.(savedSlugs.length);
  }, [savedSlugs.length, onCountChange]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setIsLoading(true);
      try {
        const [entityResponse, planResponse] = await Promise.all([
          axios.get('/users/savedResearchEntities', { withCredentials: true }),
          axios.get('/users/savedResearchEntityPlans', { withCredentials: true }),
        ]);
        if (!active) return;
        const loadedEntities: SavedResearchEntity[] =
          entityResponse.data.savedResearchEntities || [];
        const plans = (planResponse.data.savedResearchEntityPlans || {}) as Record<
          string,
          { privateNotes?: string; stage?: string }
        >;
        const loadedNotes: Record<string, string> = {};
        const loadedStages: Record<string, ResearchPlanStage> = {};
        for (const entity of loadedEntities) {
          loadedNotes[entity._id] = plans[entity._id]?.privateNotes || '';
          loadedStages[entity._id] = normalizeResearchPlanStage(plans[entity._id]?.stage);
        }
        setEntities(loadedEntities);
        setNotes(loadedNotes);
        setStages(loadedStages);
      } catch {
        if (!active) return;
        console.error('Error fetching saved research plans.');
        setEntities([]);
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

  const savePlanNote = useCallback(async (entityId: string, note: string) => {
    setSaveStatuses((statuses) => ({ ...statuses, [entityId]: 'saving' }));
    try {
      await axios.put(`/users/savedResearchEntityPlans/${entityId}`, {
        data: { plan: { privateNotes: note } },
      });
      setSaveStatuses((statuses) => ({ ...statuses, [entityId]: 'saved' }));
    } catch {
      console.error('Error saving research plan note.');
      setSaveStatuses((statuses) => ({ ...statuses, [entityId]: 'error' }));
    }
  }, []);

  const scheduleNoteSave = (entityId: string, note: string) => {
    clearTimeout(noteTimersRef.current[entityId]);
    setSaveStatuses((statuses) => ({ ...statuses, [entityId]: 'idle' }));
    noteTimersRef.current[entityId] = setTimeout(() => {
      void savePlanNote(entityId, note);
    }, 700);
  };

  const flushNoteSave = (entityId: string) => {
    clearTimeout(noteTimersRef.current[entityId]);
    void savePlanNote(entityId, notes[entityId] || '');
  };

  const changeStage = useCallback(
    async (entityId: string, nextStage: ResearchPlanStage) => {
      const previousStage = stages[entityId] || DEFAULT_RESEARCH_PLAN_STAGE;
      if (previousStage === nextStage) return;
      setStages((current) => ({ ...current, [entityId]: nextStage }));
      setStageStatuses((statuses) => ({ ...statuses, [entityId]: 'saving' }));
      try {
        await axios.put(`/users/savedResearchEntityPlans/${entityId}`, {
          data: { plan: { stage: nextStage } },
        });
        setStageStatuses((statuses) => ({ ...statuses, [entityId]: 'saved' }));
      } catch {
        console.error('Error saving research plan stage.');
        setStages((current) => ({ ...current, [entityId]: previousStage }));
        setStageStatuses((statuses) => ({ ...statuses, [entityId]: 'error' }));
      }
    },
    [stages],
  );

  const unsavePlan = (slug: string) => {
    void setFavorite(slug, false);
  };

  const visibleEntities = useMemo(
    () => entities.filter((entity) => savedSlugs.includes(entity.slug)),
    [entities, savedSlugs],
  );

  const accessStatuses = useMemo(() => {
    const statuses = new Map<string, UndergraduateAccessStatus>();
    for (const entity of visibleEntities) {
      const status = deriveUndergraduateAccessStatus(entity);
      if (status) statuses.set(entity._id, status);
    }
    return statuses;
  }, [visibleEntities]);

  const stageOf = useCallback(
    (entityId: string): ResearchPlanStage => stages[entityId] || DEFAULT_RESEARCH_PLAN_STAGE,
    [stages],
  );

  const orderedEntities = useMemo(
    () =>
      visibleEntities
        .map((entity, index) => ({ entity, index }))
        .sort((a, b) => {
          const stageDelta =
            researchPlanStageOrder(stageOf(a.entity._id)) -
            researchPlanStageOrder(stageOf(b.entity._id));
          if (stageDelta !== 0) return stageDelta;
          const accessDelta =
            undergraduateAccessSortRank(accessStatuses.get(a.entity._id) || null) -
            undergraduateAccessSortRank(accessStatuses.get(b.entity._id) || null);
          if (accessDelta !== 0) return accessDelta;
          return a.index - b.index;
        })
        .map(({ entity }) => entity),
    [visibleEntities, stageOf, accessStatuses],
  );

  const currentlyOpenCount = useMemo(
    () =>
      visibleEntities.filter((entity) => accessStatuses.get(entity._id)?.isCurrentlyOpen).length,
    [visibleEntities, accessStatuses],
  );

  useEffect(() => {
    onOpenCountChange?.(currentlyOpenCount);
  }, [currentlyOpenCount, onOpenCountChange]);

  const selectableIds = useMemo(
    () => new Set(visibleEntities.map((entity) => entity._id)),
    [visibleEntities],
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

  return (
    <section className="mb-8">
      <div className="mb-2">
        <h2 className="text-2xl font-bold text-gray-800">Saved research plans</h2>
        <p className="mt-1 text-sm text-gray-500">
          Open a saved research home to find its official profile and reach out, keep private notes,
          or remove it from your plans.
        </p>
      </div>

      {visibleEntities.length >= MIN_COMPARE_ENTITIES && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel-muted)] px-4 py-3">
          <p className="text-sm text-gray-700">
            {selectedCount === 0
              ? 'Select 2 to 4 saved homes to compare them side by side.'
              : `${selectedCount} selected to compare`}
          </p>
          <button
            type="button"
            onClick={() => setIsComparing(true)}
            disabled={!canCompare}
            className="inline-flex min-h-[44px] items-center rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-navy yr-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            Compare{selectedCount > 0 ? ` (${selectedCount})` : ''}
          </button>
          {selectedCount === 1 && (
            <span className="text-xs text-gray-500">Select at least 2 to compare.</span>
          )}
          {atCompareLimit && (
            <span className="text-xs text-gray-500">You can compare up to 4 at once.</span>
          )}
          {selectedCount > 0 && (
            <button
              type="button"
              onClick={() => setSelectedForCompare([])}
              className="text-xs font-medium text-gray-600 underline hover:text-gray-800 yr-focus-ring"
            >
              Clear selection
            </button>
          )}
        </div>
      )}

      {visibleEntities.length > 0 ? (
        <ul>
          {orderedEntities.map((entity) => {
            const status = saveStatuses[entity._id];
            const accessStatus = accessStatuses.get(entity._id) || null;
            const isEditing = editingId === entity._id;
            const note = notes[entity._id] || '';
            const stage = stageOf(entity._id);
            const isClosed = !isActiveResearchPlanStage(stage);
            return (
              <li key={entity._id} className="mb-2">
                <div
                  className={`rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4 ${
                    isClosed ? 'opacity-60' : ''
                  }`}
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      {visibleEntities.length >= MIN_COMPARE_ENTITIES && (
                        <input
                          type="checkbox"
                          checked={selectedForCompare.includes(entity._id)}
                          disabled={atCompareLimit && !selectedForCompare.includes(entity._id)}
                          onChange={() => toggleCompareSelection(entity._id)}
                          aria-label={`Select ${entityDisplayName(entity)} to compare`}
                          className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-line-strong accent-brand yr-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
                        />
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-brand">{kindLabel(entity.kind)}</p>
                        <h3 className="truncate text-sm font-semibold text-gray-900">
                          <Link
                            to={`/research/${safeRouteSegment(entity.slug)}`}
                            className="hover:text-brand focus-visible:rounded-sm yr-focus-ring"
                          >
                            {entityDisplayName(entity)}
                          </Link>
                        </h3>
                        {entitySubtitle(entity) && (
                          <p className="truncate text-xs text-gray-500">{entitySubtitle(entity)}</p>
                        )}
                        {accessStatus && (
                          <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <span
                              className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-semibold ${accessBadgeClass(
                                accessStatus.tone,
                              )}`}
                            >
                              {accessStatus.label}
                            </span>
                            {accessStatus.tone === 'muted' && accessStatus.detail && (
                              <span className="text-xs text-gray-500">{accessStatus.detail}</span>
                            )}
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
                        className={`inline-flex min-h-[44px] items-center rounded-md border px-3 py-2 text-xs font-semibold transition-colors yr-focus-ring ${
                          note
                            ? 'border-yellow-300 bg-yellow-50 text-yellow-700 hover:bg-yellow-100'
                            : 'border-[var(--yr-line)] text-gray-600 hover:bg-[var(--yr-panel-muted)]'
                        }`}
                      >
                        {isEditing ? 'Hide notes' : note ? 'Notes' : 'Add note'}
                      </button>
                      <Link
                        to={`/research/${safeRouteSegment(entity.slug)}`}
                        className="inline-flex min-h-[44px] items-center rounded-md border border-line-brand bg-brand-soft px-3 py-2 text-xs font-semibold text-brand hover:bg-panel yr-focus-ring"
                      >
                        Open
                      </Link>
                      <button
                        type="button"
                        onClick={() => unsavePlan(entity.slug)}
                        aria-label={`Remove ${entityDisplayName(entity)} from saved plans`}
                        className="inline-flex min-h-[44px] items-center rounded-md border border-[var(--yr-line)] px-3 py-2 text-xs font-semibold text-gray-600 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600 yr-focus-ring"
                      >
                        Unsave
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                    <span className="text-xs font-medium text-gray-600">Outreach stage</span>
                    <ResearchPlanStageControl
                      stage={stage}
                      onChange={(nextStage) => void changeStage(entity._id, nextStage)}
                      controlLabel={`Outreach stage for ${entityDisplayName(entity)}`}
                      status={stageStatuses[entity._id]}
                    />
                  </div>

                  {!isEditing && note && (
                    <p className="mt-2 truncate text-xs italic text-gray-500">Note: {note}</p>
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
                        onBlur={() => flushNoteSave(entity._id)}
                        maxLength={MAX_PLAN_NOTES_LENGTH}
                        placeholder="Add a private note about this research home..."
                        rows={2}
                        className="w-full rounded-md border border-[var(--yr-line)] px-3 py-2 text-base yr-focus-ring focus:border-[var(--yr-blue)]"
                      />
                      <p
                        className={`mt-1 text-xs ${
                          status === 'error' ? 'text-red-700' : 'text-gray-500'
                        }`}
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
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="rounded-md border border-dashed border-[var(--yr-line-strong)] bg-[var(--yr-panel-muted)] p-5 text-center">
          <h3 className="text-base font-semibold text-gray-950">No saved research plans yet</h3>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-gray-600">
            Save a lab, center, or faculty research home while browsing and it will show up here to
            open, annotate, and revisit.
          </p>
          <Link
            to="/research"
            className="mt-4 inline-flex min-h-[44px] items-center rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-navy yr-focus-ring"
          >
            Explore Research
          </Link>
        </div>
      )}

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
