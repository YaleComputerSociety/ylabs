import ActiveFilterChip from './ActiveFilterChip';
import { researchEntityTypeFilterLabel } from '../../utils/researchEntityCopy';

interface ResearchZeroResultRecoveryProps {
  isDepartmentSearch: boolean;
  activeFilterCount: number;
  selectedEntityType: string;
  selectedSchool: string;
  selectedDepartment: string;
  departmentLabel: (value: string) => string;
  onRemoveEntityType: () => void;
  onRemoveSchool: () => void;
  onRemoveDepartment: () => void;
  onClearAllFilters: () => void;
  relaxedQuery: string | null;
  onRelaxQuery: () => void;
  onBrowseAll: () => void;
}

const actionClassName =
  'yr-focus-ring yr-pill yr-pill-blue inline-flex min-h-11 items-center px-3 py-2 text-sm font-semibold transition-colors hover:border-brand hover:bg-panel';

const ResearchZeroResultRecovery = ({
  isDepartmentSearch,
  activeFilterCount,
  selectedEntityType,
  selectedSchool,
  selectedDepartment,
  departmentLabel,
  onRemoveEntityType,
  onRemoveSchool,
  onRemoveDepartment,
  onClearAllFilters,
  relaxedQuery,
  onRelaxQuery,
  onBrowseAll,
}: ResearchZeroResultRecoveryProps) => (
  <section
    aria-label="Ways to recover this search"
    className="yr-muted-surface rounded-card border-dashed p-4"
  >
    <p className="text-sm leading-relaxed text-muted">
      {isDepartmentSearch
        ? 'This is a data coverage gap, not proof that the department has no undergraduate research. Try one of the recovery options below while this department is being seeded.'
        : 'No indexed research matched this search yet. This is a coverage gap, not proof that no such research exists at Yale. Try one of the recovery options below while coverage improves.'}
    </p>

    {activeFilterCount > 0 && (
      <div className="mt-4">
        <p className="text-sm font-medium text-ink">
          Active filters removed every match. Clear them to widen your search.
        </p>
        <div
          className="mt-2 flex min-w-0 max-w-full flex-wrap gap-2"
          aria-label="Active research filters"
        >
          {selectedEntityType && (
            <ActiveFilterChip
              axis="Type"
              value={researchEntityTypeFilterLabel(selectedEntityType)}
              onRemove={onRemoveEntityType}
            />
          )}
          {selectedSchool && (
            <ActiveFilterChip axis="School" value={selectedSchool} onRemove={onRemoveSchool} />
          )}
          {selectedDepartment && (
            <ActiveFilterChip
              axis="Department"
              value={departmentLabel(selectedDepartment)}
              onRemove={onRemoveDepartment}
            />
          )}
        </div>
        <button
          type="button"
          onClick={onClearAllFilters}
          className="yr-focus-ring mt-2 inline-flex min-h-11 items-center justify-center rounded-card border border-[var(--yr-line-strong)] px-3 text-sm font-semibold text-ink-soft hover:bg-[var(--yr-panel-muted)]"
        >
          Clear all filters
        </button>
      </div>
    )}

    {relaxedQuery && (
      <div className="mt-4">
        <button type="button" onClick={onRelaxQuery} className={actionClassName}>
          Search &lsquo;{relaxedQuery}&rsquo; instead
        </button>
      </div>
    )}

    <div className="mt-4">
      <button
        type="button"
        onClick={onBrowseAll}
        className="yr-focus-ring inline-flex min-h-11 items-center justify-center rounded-card border border-[var(--yr-line-strong)] px-3 text-sm font-semibold text-ink-soft hover:bg-[var(--yr-panel-muted)]"
      >
        Browse all research
      </button>
    </div>
  </section>
);

export default ResearchZeroResultRecovery;
