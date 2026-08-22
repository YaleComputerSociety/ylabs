/**
 * Account dashboard workspace for saved research plans.
 *
 * Renders the student's saved research homes (canonical ResearchPlan, served by
 * /users/savedResearchEntities and /users/savedResearchEntityPlans) so a saved
 * plan can be opened, annotated, and removed rather than only counted.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from '../../utils/axios';
import useFavorites from '../../hooks/useFavorites';
import LoadingSpinner from '../shared/LoadingSpinner';
import { safeRouteSegment } from '../../utils/url';

interface SavedResearchPlansProps {
  onCountChange?: (count: number) => void;
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
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const MAX_PLAN_NOTES_LENGTH = 2000;

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

const SavedResearchPlans = ({ onCountChange }: SavedResearchPlansProps) => {
  const { favIds: savedSlugs, setFavorite } = useFavorites('researchPlans');
  const [entities, setEntities] = useState<SavedResearchEntity[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saveStatuses, setSaveStatuses] = useState<Record<string, SaveStatus>>({});
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
          { privateNotes?: string }
        >;
        const loadedNotes: Record<string, string> = {};
        for (const entity of loadedEntities) {
          loadedNotes[entity._id] = plans[entity._id]?.privateNotes || '';
        }
        setEntities(loadedEntities);
        setNotes(loadedNotes);
      } catch {
        if (!active) return;
        console.error('Error fetching saved research plans.');
        setEntities([]);
        setNotes({});
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

  const unsavePlan = (slug: string) => {
    void setFavorite(slug, false);
  };

  const visibleEntities = entities.filter((entity) => savedSlugs.includes(entity.slug));

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
          Open a saved research home to email the PI, keep private notes, or remove it from your
          plans.
        </p>
      </div>

      {visibleEntities.length > 0 ? (
        <ul>
          {visibleEntities.map((entity) => {
            const status = saveStatuses[entity._id];
            const isEditing = editingId === entity._id;
            const note = notes[entity._id] || '';
            return (
              <li key={entity._id} className="mb-2">
                <div className="rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-blue-700">
                        {kindLabel(entity.kind)}
                      </p>
                      <h3 className="truncate text-sm font-semibold text-gray-900">
                        <Link
                          to={`/research/${safeRouteSegment(entity.slug)}`}
                          className="hover:text-blue-700 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                        >
                          {entityDisplayName(entity)}
                        </Link>
                      </h3>
                      {entitySubtitle(entity) && (
                        <p className="truncate text-xs text-gray-500">{entitySubtitle(entity)}</p>
                      )}
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setEditingId((current) => (current === entity._id ? null : entity._id))
                        }
                        aria-expanded={isEditing}
                        className={`inline-flex min-h-[44px] items-center rounded-md border px-3 py-2 text-xs font-semibold transition-colors ${
                          note
                            ? 'border-yellow-300 bg-yellow-50 text-yellow-700 hover:bg-yellow-100'
                            : 'border-[var(--yr-line)] text-gray-600 hover:bg-[var(--yr-panel-muted)]'
                        }`}
                      >
                        {isEditing ? 'Hide notes' : note ? 'Notes' : 'Add note'}
                      </button>
                      <Link
                        to={`/research/${safeRouteSegment(entity.slug)}`}
                        className="inline-flex min-h-[44px] items-center rounded-md border border-blue-200 bg-[var(--yr-blue-soft)] px-3 py-2 text-xs font-semibold text-[var(--yr-blue)] hover:bg-[var(--yr-panel)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                      >
                        Open
                      </Link>
                      <button
                        type="button"
                        onClick={() => unsavePlan(entity.slug)}
                        aria-label={`Remove ${entityDisplayName(entity)} from saved plans`}
                        className="inline-flex min-h-[44px] items-center rounded-md border border-[var(--yr-line)] px-3 py-2 text-xs font-semibold text-gray-600 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                      >
                        Unsave
                      </button>
                    </div>
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
                        className="w-full rounded-md border border-[var(--yr-line)] px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
            className="mt-4 inline-flex min-h-[44px] items-center rounded-md bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
          >
            Explore Research
          </Link>
        </div>
      )}
    </section>
  );
};

export default SavedResearchPlans;
