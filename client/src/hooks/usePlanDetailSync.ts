import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { isAxiosError } from 'axios';
import axios from '../utils/axios';
import { normalizeResearchPlanStage, type ResearchPlanStage } from '../utils/researchPlanStages';

export interface ServedPlanDetail {
  privateNotes?: string;
  stage?: string;
  updatedAt?: string;
}

export type ServedPlans = Record<string, ServedPlanDetail>;

interface PlanRefreshOptions {
  adoptVersionOf?: string;
  takeStageOf?: string;
}

interface PlanSnapshot {
  note: string;
  stage: ResearchPlanStage;
  updatedAt?: string;
}

export const isPlanVersionConflict = (error: unknown): boolean =>
  (isAxiosError(error) && error.response?.status === 409) ||
  (error instanceof Error && /\b409\b/.test(error.message));

const isOlderThan = (fresh: PlanSnapshot, snapshot: PlanSnapshot | undefined) =>
  Boolean(
    fresh.updatedAt &&
    snapshot?.updatedAt &&
    Date.parse(fresh.updatedAt) < Date.parse(snapshot.updatedAt),
  );

const snapshotOf = (plan: ServedPlanDetail | undefined): PlanSnapshot => ({
  note: plan?.privateNotes || '',
  stage: normalizeResearchPlanStage(plan?.stage),
  updatedAt: plan?.updatedAt,
});

interface PlanDetailSyncOptions {
  plansPath: string;
  responseKey: string;
  notes: Record<string, string>;
  stages: Record<string, ResearchPlanStage>;
  setNotes: Dispatch<SetStateAction<Record<string, string>>>;
  setStages: Dispatch<SetStateAction<Record<string, ResearchPlanStage>>>;
  markNotePersisted: (id: string, note: string) => void;
}

/**
 * Keeps each listed plan's stage and note in step with the server across tabs. A row takes
 * the server's values on focus only where this tab holds no unsaved edit of its own, and
 * every write names the version it was edited from, so a stale tab is refused rather than
 * silently replacing a newer stage or note (#5241).
 */
const usePlanDetailSync = ({
  plansPath,
  responseKey,
  notes,
  stages,
  setNotes,
  setStages,
  markNotePersisted,
}: PlanDetailSyncOptions) => {
  const snapshotsRef = useRef<Record<string, PlanSnapshot>>({});
  const writesRef = useRef<Record<string, Promise<void> | undefined>>({});
  const notesRef = useRef(notes);
  const stagesRef = useRef(stages);

  useEffect(() => {
    notesRef.current = notes;
    stagesRef.current = stages;
  }, [notes, stages]);

  const recordServedPlan = useCallback((id: string, plan: ServedPlanDetail | undefined) => {
    snapshotsRef.current[id] = snapshotOf(plan);
  }, []);

  const fetchPlans = useCallback(async (): Promise<ServedPlans> => {
    const response = await axios.get(plansPath, { withCredentials: true });
    return (response.data?.[responseKey] || {}) as ServedPlans;
  }, [plansPath, responseKey]);

  const applyFreshPlans = useCallback(
    (plans: ServedPlans, { adoptVersionOf, takeStageOf }: PlanRefreshOptions = {}) => {
      const nextNotes: Record<string, string> = {};
      const nextStages: Record<string, ResearchPlanStage> = {};
      Object.entries(snapshotsRef.current).forEach(([id, snapshot]) => {
        const plan = plans[id];
        if (!plan) return;
        const fresh = snapshotOf(plan);
        if (isOlderThan(fresh, snapshot)) return;
        const noteIsClean = (notesRef.current[id] ?? '') === snapshot.note;
        const shownStage = stagesRef.current[id] ?? snapshot.stage;
        const stageIsClean = takeStageOf === id || shownStage === snapshot.stage;
        if (noteIsClean && fresh.note !== snapshot.note) {
          nextNotes[id] = fresh.note;
          markNotePersisted(id, fresh.note);
        }
        if (stageIsClean && fresh.stage !== shownStage) nextStages[id] = fresh.stage;
        snapshotsRef.current[id] = {
          note: noteIsClean ? fresh.note : snapshot.note,
          stage: stageIsClean ? fresh.stage : snapshot.stage,
          updatedAt:
            (noteIsClean && stageIsClean) || adoptVersionOf === id
              ? fresh.updatedAt
              : snapshot.updatedAt,
        };
      });
      if (Object.keys(nextNotes).length) setNotes((current) => ({ ...current, ...nextNotes }));
      if (Object.keys(nextStages).length) setStages((current) => ({ ...current, ...nextStages }));
    },
    [markNotePersisted, setNotes, setStages],
  );

  const refreshPlanDetails = useCallback(
    async (options?: PlanRefreshOptions) => {
      try {
        applyFreshPlans(await fetchPlans(), options);
      } catch {
        console.error('Error refreshing plan details.');
      }
    },
    [applyFreshPlans, fetchPlans],
  );

  const writePlan = useCallback(
    (
      id: string,
      send: (expectedUpdatedAt: string | undefined) => Promise<ServedPlans | undefined>,
      { immediate = false }: { immediate?: boolean } = {},
    ) => {
      const run = async () => {
        const plan = (await send(snapshotsRef.current[id]?.updatedAt))?.[id];
        if (!plan) return;
        const served = snapshotOf(plan);
        if (!isOlderThan(served, snapshotsRef.current[id])) snapshotsRef.current[id] = served;
      };
      const previous = writesRef.current[id];
      const write = previous && !immediate ? previous.then(run) : run();
      const settled = write.catch(() => undefined);
      const tail = previous ? previous.then(() => settled) : settled;
      writesRef.current[id] = tail;
      void tail.then(() => {
        if (writesRef.current[id] === tail) delete writesRef.current[id];
      });
      return write;
    },
    [],
  );

  const takeServerStage = useCallback(
    (id: string) => refreshPlanDetails({ takeStageOf: id }),
    [refreshPlanDetails],
  );

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshPlanDetails();
    };
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => document.removeEventListener('visibilitychange', refreshWhenVisible);
  }, [refreshPlanDetails]);

  return {
    recordServedPlan,
    writePlan,
    refreshPlanDetails,
    takeServerStage,
  };
};

export default usePlanDetailSync;
