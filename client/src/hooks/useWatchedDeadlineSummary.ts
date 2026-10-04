import { useCallback, useState } from 'react';
import axios from '../utils/axios';
import { createFellowship } from '../utils/createFellowship';
import {
  EMPTY_WATCHED_DEADLINE_SUMMARY,
  summarizeWatchedDeadlines,
  WatchedDeadlineSummary,
  WatchedProgramWithStage,
} from '../utils/watchedDeadlineSummary';
import useLatestRequest from './useLatestRequest';
import useLoadEffect from './useLoadEffect';

interface WatchedDeadlineSummaryState extends WatchedDeadlineSummary {
  isLoading: boolean;
}

const IDLE_STATE: WatchedDeadlineSummaryState = {
  ...EMPTY_WATCHED_DEADLINE_SUMMARY,
  isLoading: false,
};

const LOADING_STATE: WatchedDeadlineSummaryState = { ...IDLE_STATE, isLoading: true };

/**
 * Fetch-once watched-program deadline summary for surfaces that do not already
 * mount ProgramWatch (the /research landing). Gated by `enabled`, fails safe to
 * an empty summary, and reuses the same pure `summarizeWatchedDeadlines`
 * derivation the dashboard page uses so the two surfaces cannot diverge.
 */
export const useWatchedDeadlineSummary = (enabled: boolean): WatchedDeadlineSummaryState => {
  const [state, setState] = useState<WatchedDeadlineSummaryState>(() =>
    enabled ? LOADING_STATE : IDLE_STATE,
  );
  const [stateEnabled, setStateEnabled] = useState(enabled);
  if (stateEnabled !== enabled) {
    setStateEnabled(enabled);
    setState(enabled ? (current) => ({ ...current, isLoading: true }) : IDLE_STATE);
  }
  const summaryRequest = useLatestRequest();

  const load = useCallback(async () => {
    const ticket = summaryRequest.begin();
    if (!enabled) return;
    try {
      const [programResponse, planResponse] = await Promise.all([
        axios.get('/users/watchedPrograms', { withCredentials: true }),
        axios.get('/users/watchedProgramPlans', { withCredentials: true }),
      ]);
      if (!ticket.isCurrent()) return;
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
    } catch {
      if (!ticket.isCurrent()) return;
      console.error('Error fetching watched-program deadline summary.');
      setState(IDLE_STATE);
    }
  }, [enabled, summaryRequest]);

  useLoadEffect(load);

  return state;
};

export default useWatchedDeadlineSummary;
