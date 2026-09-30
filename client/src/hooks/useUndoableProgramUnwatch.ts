import { useCallback } from 'react';
import axios from '../utils/axios';
import useUndoableRemoval from './useUndoableRemoval';
import { showWarningDialog } from '../utils/warningDialog';
import type { ResearchSaveSurface } from '../utils/researchAnalytics';
import {
  DEFAULT_RESEARCH_PLAN_STAGE,
  normalizeResearchPlanStage,
  type ResearchPlanStage,
} from '../utils/researchPlanStages';

export interface WatchedProgramPlanSnapshot {
  privateNotes: string;
  stage: ResearchPlanStage;
}

export interface UnwatchedProgram {
  id: string;
  title: string;
  plan: WatchedProgramPlanSnapshot;
}

type SetFavorite = (
  id: string,
  favorite: boolean,
  surface?: ResearchSaveSurface,
) => Promise<boolean>;

export const watchedProgramPlanSnapshot = (plan?: {
  privateNotes?: string;
  stage?: string;
}): WatchedProgramPlanSnapshot => ({
  privateNotes: plan?.privateNotes || '',
  stage: normalizeResearchPlanStage(plan?.stage),
});

const hasNote = (plan: WatchedProgramPlanSnapshot) => plan.privateNotes.length > 0;
const hasStage = (plan: WatchedProgramPlanSnapshot) => plan.stage !== DEFAULT_RESEARCH_PLAN_STAGE;

export const undoRestoresSummary = (plan: WatchedProgramPlanSnapshot): string => {
  if (hasNote(plan) && hasStage(plan)) return ' Undo restores your note and stage too.';
  if (hasNote(plan)) return ' Undo restores your note too.';
  if (hasStage(plan)) return ' Undo restores your stage too.';
  return '';
};

const useUndoableProgramUnwatch = ({
  setFavorite,
  surface,
  onPlanRestored,
}: {
  setFavorite: SetFavorite;
  surface: ResearchSaveSurface;
  onPlanRestored?: (programId: string, plan: WatchedProgramPlanSnapshot) => void;
}) => {
  const { undoableItem, offerUndo, undoRemoval, restartUndoWindow } =
    useUndoableRemoval<UnwatchedProgram>();

  const unwatchProgram = useCallback(
    (program: { id: string; title: string }, plan: WatchedProgramPlanSnapshot) => {
      const removal = setFavorite(program.id, false, surface);
      offerUndo({ id: program.id, title: program.title, plan }, removal);
      return removal;
    },
    [setFavorite, surface, offerUndo],
  );

  const restoreProgram = useCallback(
    async ({ id, plan }: UnwatchedProgram) => {
      if (!(await setFavorite(id, true, surface))) return false;
      if (!hasNote(plan) && !hasStage(plan)) return true;
      try {
        await axios.put(`/users/watchedProgramPlans/${id}`, {
          data: { plan: { privateNotes: plan.privateNotes, stage: plan.stage } },
        });
        onPlanRestored?.(id, plan);
        return true;
      } catch {
        console.error('Error restoring watched program plan.');
        void showWarningDialog(
          'The program is watched again, but its note and stage were not restored. Press Undo to try again.',
        );
        return false;
      }
    },
    [setFavorite, surface, onPlanRestored],
  );

  const undoUnwatch = useCallback(() => undoRemoval(restoreProgram), [undoRemoval, restoreProgram]);

  return { unwatchedProgram: undoableItem, unwatchProgram, undoUnwatch, restartUndoWindow };
};

export default useUndoableProgramUnwatch;
