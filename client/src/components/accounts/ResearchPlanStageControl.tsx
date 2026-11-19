/**
 * Shared plan-stage control for saved research and watched programs.
 *
 * Renders the stages a surface offers as a single accessible, labeled select:
 * the outreach stages on a research card and the application stages on a
 * program card. A plan stored at a stage its surface no longer offers keeps
 * that stage listed and selected until the student picks another. The select
 * is tinted by stage for at-a-glance scanning, and an optional live status
 * region mirrors the note-save feedback used elsewhere on the account dashboard.
 */
import {
  researchPlanStageLabel,
  researchPlanStageMeta,
  researchPlanStageOptions,
  type ResearchPlanStage,
  type ResearchPlanStageSurface,
} from '../../utils/researchPlanStages';

export type PlanSaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

interface ResearchPlanStageControlProps {
  stage: ResearchPlanStage;
  onChange: (stage: ResearchPlanStage) => void;
  controlLabel: string;
  status?: PlanSaveStatus;
  surface?: ResearchPlanStageSurface;
}

const statusMessage = (status?: PlanSaveStatus): string => {
  switch (status) {
    case 'saving':
      return 'Saving…';
    case 'saved':
      return 'Saved';
    case 'error':
      return 'Not saved. Check your connection or sign in again, then retry.';
    case 'conflict':
      return 'Changed in another tab. Showing the latest stage.';
    default:
      return '';
  }
};

const ResearchPlanStageControl = ({
  stage,
  onChange,
  controlLabel,
  status,
  surface = 'research',
}: ResearchPlanStageControlProps) => {
  const message = statusMessage(status);
  return (
    <div className="flex flex-col gap-1">
      <select
        aria-label={controlLabel}
        value={stage}
        onChange={(event) => onChange(event.target.value as ResearchPlanStage)}
        className={`min-h-[44px] rounded-control border px-3 text-base font-semibold transition-colors yr-focus-ring ${researchPlanStageMeta[stage].badgeClassName}`}
      >
        {researchPlanStageOptions(surface, stage).map((option) => (
          <option key={option} value={option}>
            {researchPlanStageLabel(option, surface)}
          </option>
        ))}
      </select>
      {message && (
        <p
          className={`text-xs ${status === 'error' || status === 'conflict' ? 'text-red-700' : 'text-muted'}`}
          role={status === 'error' || status === 'conflict' ? 'alert' : 'status'}
          aria-live="polite"
        >
          {message}
        </p>
      )}
    </div>
  );
};

export default ResearchPlanStageControl;
