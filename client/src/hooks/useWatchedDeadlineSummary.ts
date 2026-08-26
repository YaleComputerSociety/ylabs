import { useEffect, useState } from 'react';
import axios from '../utils/axios';
import { createFellowship } from '../utils/createFellowship';
import {
  EMPTY_WATCHED_DEADLINE_SUMMARY,
  summarizeWatchedDeadlines,
  WatchedDeadlineSummary,
  WatchedProgramWithStage,
} from '../utils/watchedDeadlineSummary';

interface WatchedDeadlineSummaryState extends WatchedDeadlineSummary {
  isLoading: boolean;
}

const IDLE_STATE: WatchedDeadlineSummaryState = {
  ...EMPTY_WATCHED_DEADLINE_SUMMARY,
  isLoading: false,
};

/**
 * Fetch-once watched-program deadline summary for surfaces that do not already
 * mount ProgramWatch (the /research landing). Gated by `enabled`, fails safe to
 * an empty summary, and reuses the same pure `summarizeWatchedDeadlines`
 * derivation the dashboard page uses so the two surfaces cannot diverge.
 */
export const useWatchedDeadlineSummary = (enabled: boolean): WatchedDeadlineSummaryState => {
  const [state, setState] = useState<WatchedDeadlineSummaryState>(IDLE_STATE);

  useEffect(() => {
    if (!enabled) {
      setState(IDLE_STATE);
      return;
    }
    let active = true;
    setState((current) => ({ ...current, isLoading: true }));
    Promise.all([
      axios.get('/users/watchedPrograms', { withCredentials: true }),
      axios.get('/users/watchedProgramPlans', { withCredentials: true }),
    ])
      .then(([programResponse, planResponse]) => {
        if (!active) return;
        const rawPrograms = (programResponse.data.watchedPrograms || []) as unknown[];
        const plans = (planResponse.data.watchedProgramPlans || {}) as Record<
          string,
          { stage?: string }
        >;
        const watched: WatchedProgramWithStage[] = rawPrograms.map((raw) => {
          const program = createFellowship(raw);
          return { program, stage: plans[program.id]?.stage };
        });
        setState({ ...summarizeWatchedDeadlines(watched), isLoading: false });
      })
      .catch(() => {
        if (!active) return;
        console.error('Error fetching watched-program deadline summary.');
        setState(IDLE_STATE);
      });
    return () => {
      active = false;
    };
  }, [enabled]);

  return state;
};

export default useWatchedDeadlineSummary;
