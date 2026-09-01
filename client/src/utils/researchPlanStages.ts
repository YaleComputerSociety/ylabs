export const researchPlanStages = [
  'SAVED',
  'EXPLORING',
  'PREPARING',
  'CONTACTED',
  'APPLIED',
  'CLOSED',
] as const;

export type ResearchPlanStage = (typeof researchPlanStages)[number];

export const DEFAULT_RESEARCH_PLAN_STAGE: ResearchPlanStage = 'SAVED';
export const CLOSED_RESEARCH_PLAN_STAGE: ResearchPlanStage = 'CLOSED';

const researchPlanStageSet = new Set<string>(researchPlanStages);

export const isResearchPlanStage = (value: unknown): value is ResearchPlanStage =>
  typeof value === 'string' && researchPlanStageSet.has(value);

export const normalizeResearchPlanStage = (value: unknown): ResearchPlanStage =>
  isResearchPlanStage(value) ? value : DEFAULT_RESEARCH_PLAN_STAGE;

export const researchPlanStageOrder = (stage: ResearchPlanStage): number =>
  researchPlanStages.indexOf(stage);

export const isActiveResearchPlanStage = (stage: ResearchPlanStage): boolean =>
  stage !== CLOSED_RESEARCH_PLAN_STAGE;

interface ResearchPlanStageMeta {
  label: string;
  badgeClassName: string;
}

export const researchPlanStageMeta: Record<ResearchPlanStage, ResearchPlanStageMeta> = {
  SAVED: { label: 'Saved', badgeClassName: 'border-gray-200 bg-gray-100 text-gray-700' },
  EXPLORING: { label: 'Exploring', badgeClassName: 'border-blue-200 bg-blue-50 text-blue-700' },
  PREPARING: {
    label: 'Preparing',
    badgeClassName: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  },
  CONTACTED: {
    label: 'Contacted',
    badgeClassName: 'border-amber-200 bg-amber-50 text-amber-700',
  },
  APPLIED: { label: 'Applied', badgeClassName: 'border-green-200 bg-green-50 text-green-700' },
  CLOSED: { label: 'Closed', badgeClassName: 'border-gray-200 bg-gray-100 text-gray-500' },
};

export const researchPlanStageLabel = (stage: ResearchPlanStage): string =>
  researchPlanStageMeta[stage].label;
