import { useEffect, useState } from 'react';
import axios from '../utils/axios';
import { createFellowship } from '../utils/createFellowship';
import { normalizeResearchPlanStage, type ResearchPlanStage } from '../utils/researchPlanStages';
import {
  computeWatchedProgramUrgencySummary,
  type WatchedProgramUrgencySummary,
} from '../utils/watchedProgramUrgency';

const EMPTY_SUMMARY: WatchedProgramUrgencySummary = {
  closingWithin14DaysCount: 0,
  hasNotStartedClosingSoon: false,
};

export const useWatchedProgramUrgency = (enabled: boolean): WatchedProgramUrgencySummary => {
  const [summary, setSummary] = useState<WatchedProgramUrgencySummary>(EMPTY_SUMMARY);

  useEffect(() => {
    if (!enabled) {
      setSummary(EMPTY_SUMMARY);
      return;
    }
    let active = true;
    const load = async () => {
      try {
        const [programResponse, planResponse] = await Promise.all([
          axios.get('/users/watchedPrograms', { withCredentials: true }),
          axios.get('/users/watchedProgramPlans', { withCredentials: true }),
        ]);
        if (!active) return;
        const rawPrograms = programResponse.data.watchedPrograms || [];
        const fellowships = rawPrograms.map((program: unknown) => createFellowship(program));
        const plans = (planResponse.data.watchedProgramPlans || {}) as Record<
          string,
          { stage?: string }
        >;
        const stages: Record<string, ResearchPlanStage> = {};
        for (const fellowship of fellowships) {
          stages[fellowship.id] = normalizeResearchPlanStage(plans[fellowship.id]?.stage);
        }
        setSummary(computeWatchedProgramUrgencySummary(fellowships, stages));
      } catch {
        if (!active) return;
        setSummary(EMPTY_SUMMARY);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [enabled]);

  return summary;
};

export default useWatchedProgramUrgency;
