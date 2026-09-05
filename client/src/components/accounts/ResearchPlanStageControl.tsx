/**
 * Shared outreach-stage control for saved research homes and watched programs.
 *
 * Renders the full ResearchPlan stage pipeline (SAVED through CLOSED) as a
 * single accessible, labeled select so a student can record where each home or
 * program sits in their outreach journey. The select is tinted by stage for
 * at-a-glance scanning, and an optional live status region mirrors the
 * note-save feedback used elsewhere on the account dashboard.
 */
import {
  researchPlanStages,
  researchPlanStageLabel,
  researchPlanStageMeta,
  type ResearchPlanStage,
} from '../../utils/researchPlanStages';

export type PlanSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface ResearchPlanStageControlProps {
  stage: ResearchPlanStage;
  onChange: (stage: ResearchPlanStage) => void;
  controlLabel: string;
  status?: PlanSaveStatus;
}

const statusMessage = (status?: PlanSaveStatus): string => {
  switch (status) {
    case 'saving':
      return 'Saving...';
    case 'saved':
      return 'Saved';
    case 'error':
      return 'Not saved. Check your connection or sign in again, then retry.';
    default:
      return '';
  }
};

const ResearchPlanStageControl = ({
  stage,
  onChange,
  controlLabel,
  status,
}: ResearchPlanStageControlProps) => {
  const message = statusMessage(status);
  return (
    <div className="flex flex-col gap-1">
      <select
        aria-label={controlLabel}
        value={stage}
        onChange={(event) => onChange(event.target.value as ResearchPlanStage)}
        className={`min-h-[44px] rounded-md border px-3 text-base font-semibold transition-colors yr-focus-ring ${researchPlanStageMeta[stage].badgeClassName}`}
      >
        {researchPlanStages.map((option) => (
          <option key={option} value={option}>
            {researchPlanStageLabel(option)}
          </option>
        ))}
      </select>
      {message && (
        <p
          className={`text-xs ${status === 'error' ? 'text-red-700' : 'text-gray-500'}`}
          role={status === 'error' ? 'alert' : 'status'}
          aria-live="polite"
        >
          {message}
        </p>
      )}
    </div>
  );
};

export default ResearchPlanStageControl;
