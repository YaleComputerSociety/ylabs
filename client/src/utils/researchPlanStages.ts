export const researchPlanStages = [
  'SAVED',
  'EXPLORING',
  'PREPARING',
  'CONTACTED',
  'APPLIED',
  'AWARDED',
  'NOT_SELECTED',
  'CLOSED',
] as const;

export type ResearchPlanStage = (typeof researchPlanStages)[number];

export type ResearchPlanStageSurface = 'research' | 'program';

export const researchOutreachStages: readonly ResearchPlanStage[] = [
  'SAVED',
  'EXPLORING',
  'PREPARING',
  'CONTACTED',
  'APPLIED',
  'CLOSED',
];

export const programApplicationStages: readonly ResearchPlanStage[] = [
  'SAVED',
  'PREPARING',
  'APPLIED',
  'AWARDED',
  'NOT_SELECTED',
  'CLOSED',
];

const stagesBySurface: Record<ResearchPlanStageSurface, readonly ResearchPlanStage[]> = {
  research: researchOutreachStages,
  program: programApplicationStages,
};

export const researchPlanStageOptions = (
  surface: ResearchPlanStageSurface,
  current?: ResearchPlanStage,
): ResearchPlanStage[] => {
  const offered = stagesBySurface[surface];
  return researchPlanStages.filter((stage) => offered.includes(stage) || stage === current);
};

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

const PROGRAM_DEADLINE_SETTLED_STAGES = new Set<ResearchPlanStage>([
  'APPLIED',
  'AWARDED',
  'NOT_SELECTED',
  'CLOSED',
]);

export const programDeadlineIsSettled = (stage: unknown): boolean =>
  PROGRAM_DEADLINE_SETTLED_STAGES.has(normalizeResearchPlanStage(stage));

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
  AWARDED: {
    label: 'Awarded',
    badgeClassName: 'border-emerald-300 bg-emerald-100 text-emerald-900',
  },
  NOT_SELECTED: {
    label: 'Not selected',
    badgeClassName: 'border-rose-200 bg-rose-50 text-rose-800',
  },
  CLOSED: { label: 'Closed', badgeClassName: 'border-gray-200 bg-gray-100 text-gray-500' },
};

const programStageLabels: Partial<Record<ResearchPlanStage, string>> = {
  CLOSED: 'No longer applying',
};

export const researchPlanStageLabel = (
  stage: ResearchPlanStage,
  surface: ResearchPlanStageSurface = 'research',
): string =>
  (surface === 'program' ? programStageLabels[stage] : undefined) ??
  researchPlanStageMeta[stage].label;

export const programSettledStageBadge = (
  stage: unknown,
): { label: string; className: string } | undefined => {
  if (!programDeadlineIsSettled(stage)) return undefined;
  const settled = normalizeResearchPlanStage(stage);
  return {
    label: researchPlanStageLabel(settled, 'program'),
    className: researchPlanStageMeta[settled].badgeClassName,
  };
};
