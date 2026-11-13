import {
  ALL_PLAN_STAGES_FILTER,
  WAITING_TO_HEAR_BACK_FILTER,
  filterableStages,
  planSortOptions,
  waitingToHearBackStages,
  planStageFilterLabel,
  type PlanListView,
  type PlanSort,
  type PlanStageCounts,
  type PlanStageFilter,
} from '../../utils/dashboardPlanListView';
import {
  researchPlanStageLabel,
  type ResearchPlanStageSurface,
} from '../../utils/researchPlanStages';

interface PlanListControlsProps {
  surface: ResearchPlanStageSurface;
  idPrefix: string;
  view: PlanListView;
  counts: PlanStageCounts;
  shownCount: number;
  pluralNoun: string;
  onChange: (view: PlanListView) => void;
}

export const planStageFilterInputId = (idPrefix: string, filter: PlanStageFilter): string =>
  `${idPrefix}-stage-${filter.toLowerCase()}`;

const countFor = (counts: PlanStageCounts, filter: PlanStageFilter): number => {
  if (filter === ALL_PLAN_STAGES_FILTER) return counts.total;
  if (filter === WAITING_TO_HEAR_BACK_FILTER) return counts.waiting;
  return counts.byStage[filter] ?? 0;
};

export const shownPlansSummary = (
  shownCount: number,
  total: number,
  pluralNoun: string,
  filterLabel: string | null,
): string =>
  filterLabel === null
    ? `Showing all ${total} ${pluralNoun}`
    : `Showing ${shownCount} of ${total} ${pluralNoun}: ${filterLabel}`;

const PlanListControls = ({
  surface,
  idPrefix,
  view,
  counts,
  shownCount,
  pluralNoun,
  onChange,
}: PlanListControlsProps) => {
  const filters: PlanStageFilter[] = [
    ALL_PLAN_STAGES_FILTER,
    WAITING_TO_HEAR_BACK_FILTER,
    ...filterableStages(surface),
  ];
  const sortId = `${idPrefix}-sort`;
  const activeFilterLabel =
    view.stageFilter === ALL_PLAN_STAGES_FILTER
      ? null
      : planStageFilterLabel(view.stageFilter, surface);

  return (
    <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between lg:gap-6">
      <fieldset className="min-w-0">
        <legend className="mb-1 text-xs font-medium text-muted">Show plans at</legend>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 py-1 sm:flex-wrap sm:overflow-visible">
          {filters.map((filter) => {
            const inputId = planStageFilterInputId(idPrefix, filter);
            const count = countFor(counts, filter);
            return (
              <label key={filter} htmlFor={inputId} className="relative shrink-0 cursor-pointer">
                <input
                  type="radio"
                  id={inputId}
                  name={`${idPrefix}-stage`}
                  value={filter}
                  aria-label={`${planStageFilterLabel(filter, surface)} (${count})`}
                  checked={view.stageFilter === filter}
                  onChange={() => onChange({ ...view, stageFilter: filter })}
                  className="peer sr-only"
                />
                <span className="yr-focus-ring-peer yr-pressable inline-flex min-h-[44px] items-center gap-2 whitespace-nowrap rounded-control border border-[var(--yr-line-control)] bg-[var(--yr-panel)] px-3 text-sm text-ink-soft transition-colors hover:bg-[var(--yr-panel-muted)] peer-checked:border-brand peer-checked:bg-brand peer-checked:text-white peer-checked:hover:bg-brand-navy">
                  {planStageFilterLabel(filter, surface)}
                  <span aria-hidden="true" className="yr-num text-xs opacity-80">
                    {count}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <div className="flex flex-shrink-0 items-center gap-2">
        <label htmlFor={sortId} className="text-xs font-medium text-muted">
          Sort by
        </label>
        <select
          id={sortId}
          value={view.sort}
          onChange={(event) => onChange({ ...view, sort: event.target.value as PlanSort })}
          className="min-h-[44px] rounded-control border border-[var(--yr-line-control)] bg-[var(--yr-panel)] px-3 text-base text-ink yr-focus-ring"
        >
          {planSortOptions(surface).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {shownPlansSummary(shownCount, counts.total, pluralNoun, activeFilterLabel)}
      </p>
    </div>
  );
};

interface PlanFilterEmptyStateProps {
  idPrefix: string;
  surface: ResearchPlanStageSurface;
  stageFilter: PlanStageFilter;
  pluralNoun: string;
  onShowAll: () => void;
}

const joinWithOr = (labels: string[]): string =>
  labels.length <= 1
    ? (labels[0] ?? '')
    : `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`;

export const planFilterEmptyCopy = (
  stageFilter: PlanStageFilter,
  surface: ResearchPlanStageSurface,
  pluralNoun: string,
): { title: string; body: string } => {
  if (stageFilter === WAITING_TO_HEAR_BACK_FILTER) {
    const stages = joinWithOr(
      waitingToHearBackStages(surface).map((stage) => researchPlanStageLabel(stage, surface)),
    );
    return {
      title: `No ${pluralNoun} waiting to hear back`,
      body: `Plans you move to ${stages} show up here. Your other plans are still saved.`,
    };
  }
  return {
    title: `No ${pluralNoun} at ${planStageFilterLabel(stageFilter, surface)}`,
    body: 'Plans you move to this stage show up here. Your other plans are still saved.',
  };
};

export const PlanFilterEmptyState = ({
  idPrefix,
  surface,
  stageFilter,
  pluralNoun,
  onShowAll,
}: PlanFilterEmptyStateProps) => {
  const copy = planFilterEmptyCopy(stageFilter, surface, pluralNoun);
  const showAll = () => {
    onShowAll();
    requestAnimationFrame(() =>
      document.getElementById(planStageFilterInputId(idPrefix, ALL_PLAN_STAGES_FILTER))?.focus(),
    );
  };
  return (
    <div className="rounded-card border border-dashed border-[var(--yr-line-strong)] bg-[var(--yr-panel-muted)] p-5 text-center">
      <h3 className="text-base font-semibold text-ink">{copy.title}</h3>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-muted">{copy.body}</p>
      <button
        type="button"
        onClick={showAll}
        className="yr-pressable mt-4 inline-flex min-h-[44px] items-center rounded-control border border-line-brand bg-brand-soft px-3 py-2 text-sm font-semibold text-brand hover:bg-panel yr-focus-ring"
      >
        Show all
      </button>
    </div>
  );
};

export default PlanListControls;
