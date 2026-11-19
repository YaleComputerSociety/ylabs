import {
  researchPlanStageLabel,
  researchPlanStageOptions,
  researchPlanStageOrder,
  type ResearchPlanStage,
  type ResearchPlanStageSurface,
} from './researchPlanStages';

export const PLAN_STAGE_PARAM = 'stage';
export const PLAN_SORT_PARAM = 'sort';

export const ALL_PLAN_STAGES_FILTER = 'all';
export const WAITING_TO_HEAR_BACK_FILTER = 'waiting';

export type PlanStageFilter =
  typeof ALL_PLAN_STAGES_FILTER | typeof WAITING_TO_HEAR_BACK_FILTER | ResearchPlanStage;

export type PlanSort = 'recent' | 'stage' | 'deadline';

export const DEFAULT_PLAN_SORT: PlanSort = 'recent';

export interface PlanListView {
  stageFilter: PlanStageFilter;
  sort: PlanSort;
}

export const DEFAULT_PLAN_LIST_VIEW: PlanListView = {
  stageFilter: ALL_PLAN_STAGES_FILTER,
  sort: DEFAULT_PLAN_SORT,
};

const waitingStagesBySurface: Record<ResearchPlanStageSurface, readonly ResearchPlanStage[]> = {
  research: ['CONTACTED', 'APPLIED'],
  program: ['APPLIED'],
};

const sortsBySurface: Record<ResearchPlanStageSurface, readonly PlanSort[]> = {
  research: ['recent', 'stage'],
  program: ['recent', 'stage', 'deadline'],
};

const planSortLabels: Record<PlanSort, string> = {
  recent: 'Recently saved',
  stage: 'Stage',
  deadline: 'Deadline',
};

export const WAITING_TO_HEAR_BACK_LABEL = 'Waiting to hear back';

export const waitingToHearBackStages = (
  surface: ResearchPlanStageSurface,
): readonly ResearchPlanStage[] => waitingStagesBySurface[surface];

export const planSortOptions = (
  surface: ResearchPlanStageSurface,
): { value: PlanSort; label: string }[] =>
  sortsBySurface[surface].map((value) => ({ value, label: planSortLabels[value] }));

export const filterableStages = (surface: ResearchPlanStageSurface): ResearchPlanStage[] =>
  researchPlanStageOptions(surface);

export const parsePlanStageFilter = (
  value: string | null,
  surface: ResearchPlanStageSurface,
): PlanStageFilter => {
  if (value === WAITING_TO_HEAR_BACK_FILTER) return WAITING_TO_HEAR_BACK_FILTER;
  const stage = filterableStages(surface).find((candidate) => candidate.toLowerCase() === value);
  return stage ?? ALL_PLAN_STAGES_FILTER;
};

export const parsePlanSort = (value: string | null, surface: ResearchPlanStageSurface): PlanSort =>
  sortsBySurface[surface].find((candidate) => candidate === value) ?? DEFAULT_PLAN_SORT;

export const parsePlanListView = (
  params: URLSearchParams,
  surface: ResearchPlanStageSurface,
): PlanListView => ({
  stageFilter: parsePlanStageFilter(params.get(PLAN_STAGE_PARAM), surface),
  sort: parsePlanSort(params.get(PLAN_SORT_PARAM), surface),
});

export const writePlanListView = (params: URLSearchParams, view: PlanListView): void => {
  if (view.stageFilter === ALL_PLAN_STAGES_FILTER) params.delete(PLAN_STAGE_PARAM);
  else params.set(PLAN_STAGE_PARAM, view.stageFilter.toLowerCase());
  if (view.sort === DEFAULT_PLAN_SORT) params.delete(PLAN_SORT_PARAM);
  else params.set(PLAN_SORT_PARAM, view.sort);
};

export const clearPlanListView = (params: URLSearchParams): void => {
  params.delete(PLAN_STAGE_PARAM);
  params.delete(PLAN_SORT_PARAM);
};

export const planMatchesStageFilter = (
  stage: ResearchPlanStage,
  filter: PlanStageFilter,
  surface: ResearchPlanStageSurface,
): boolean => {
  if (filter === ALL_PLAN_STAGES_FILTER) return true;
  if (filter === WAITING_TO_HEAR_BACK_FILTER)
    return waitingToHearBackStages(surface).includes(stage);
  return stage === filter;
};

export const planStageFilterLabel = (
  filter: PlanStageFilter,
  surface: ResearchPlanStageSurface,
): string => {
  if (filter === ALL_PLAN_STAGES_FILTER) return 'All';
  if (filter === WAITING_TO_HEAR_BACK_FILTER) return WAITING_TO_HEAR_BACK_LABEL;
  return researchPlanStageLabel(filter, surface);
};

const savedAtTime = (createdAt: string | undefined): number => {
  const time = createdAt ? Date.parse(createdAt) : Number.NaN;
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
};

export const compareNewestSavedFirst = (a: string | undefined, b: string | undefined): number => {
  const timeA = savedAtTime(a);
  const timeB = savedAtTime(b);
  if (timeA === timeB) return 0;
  return timeB > timeA ? 1 : -1;
};

export const compareStageOrder = (a: ResearchPlanStage, b: ResearchPlanStage): number =>
  researchPlanStageOrder(a) - researchPlanStageOrder(b);

export const orderStably = <T>(items: readonly T[], compare: (a: T, b: T) => number): T[] =>
  items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => compare(a.item, b.item) || a.index - b.index)
    .map(({ item }) => item);

export interface PlanStageCounts {
  total: number;
  waiting: number;
  byStage: Partial<Record<ResearchPlanStage, number>>;
}

export const countPlansByStage = (
  stages: readonly ResearchPlanStage[],
  surface: ResearchPlanStageSurface,
): PlanStageCounts => {
  const byStage: Partial<Record<ResearchPlanStage, number>> = {};
  let waiting = 0;
  for (const stage of stages) {
    byStage[stage] = (byStage[stage] ?? 0) + 1;
    if (planMatchesStageFilter(stage, WAITING_TO_HEAR_BACK_FILTER, surface)) waiting += 1;
  }
  return { total: stages.length, waiting, byStage };
};
