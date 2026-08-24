interface ResearchZeroResultRecoveryProps {
  isDepartmentSearch: boolean;
  activeFilterCount: number;
  selectedSchool: string;
  selectedDepartment: string;
  selectedResearchAreas: string[];
  hostsUndergrads: boolean;
  departmentLabel: (value: string) => string;
  onRemoveSchool: () => void;
  onRemoveDepartment: () => void;
  onRemoveResearchArea: (value: string) => void;
  onRemoveHostsUndergrads: () => void;
  onClearAllFilters: () => void;
  relaxedQuery: string | null;
  onRelaxQuery: () => void;
  researchAreaSuggestions: string[];
  onSelectResearchArea: (value: string) => void;
  onBrowseAll: () => void;
}

const chipClassName =
  'inline-flex min-h-11 max-w-full min-w-0 items-center gap-2 rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] px-3 text-sm text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200';

const actionClassName =
  'yr-pill yr-pill-blue inline-flex min-h-11 items-center rounded-md px-3 py-2 text-sm font-semibold transition-colors hover:border-blue-300 hover:bg-[var(--yr-panel)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200';

const ResearchZeroResultRecovery = ({
  isDepartmentSearch,
  activeFilterCount,
  selectedSchool,
  selectedDepartment,
  selectedResearchAreas,
  hostsUndergrads,
  departmentLabel,
  onRemoveSchool,
  onRemoveDepartment,
  onRemoveResearchArea,
  onRemoveHostsUndergrads,
  onClearAllFilters,
  relaxedQuery,
  onRelaxQuery,
  researchAreaSuggestions,
  onSelectResearchArea,
  onBrowseAll,
}: ResearchZeroResultRecoveryProps) => (
  <section
    aria-label="Ways to recover this search"
    className="yr-muted-surface rounded-md border-dashed p-4"
  >
    <p className="text-sm leading-relaxed text-slate-600">
      {isDepartmentSearch
        ? 'This is a data coverage gap, not proof that the department has no undergraduate research. Try one of the recovery options below while this department is being seeded.'
        : 'No indexed research homes matched this search yet. This is a coverage gap, not proof that no such research exists at Yale. Try one of the recovery options below while coverage improves.'}
    </p>

    {activeFilterCount > 0 && (
      <div className="mt-4">
        <p className="text-sm font-medium text-slate-800">
          Active filters removed every match. Clear them to widen your search.
        </p>
        <div
          className="mt-2 flex min-w-0 max-w-full flex-wrap gap-2"
          aria-label="Active research filters"
        >
          {selectedSchool && (
            <button
              type="button"
              onClick={onRemoveSchool}
              aria-label={`Remove School: ${selectedSchool}`}
              className={chipClassName}
            >
              <span className="min-w-0 truncate">School: {selectedSchool}</span>
              <span aria-hidden="true" className="shrink-0">
                ×
              </span>
            </button>
          )}
          {selectedDepartment && (
            <button
              type="button"
              onClick={onRemoveDepartment}
              aria-label={`Remove Department: ${departmentLabel(selectedDepartment)}`}
              className={chipClassName}
            >
              <span className="min-w-0 truncate">
                Department: {departmentLabel(selectedDepartment)}
              </span>
              <span aria-hidden="true" className="shrink-0">
                ×
              </span>
            </button>
          )}
          {selectedResearchAreas.map((area) => (
            <button
              key={area}
              type="button"
              onClick={() => onRemoveResearchArea(area)}
              aria-label={`Remove Research area: ${area}`}
              className={chipClassName}
            >
              <span className="min-w-0 truncate">Research area: {area}</span>
              <span aria-hidden="true" className="shrink-0">
                ×
              </span>
            </button>
          ))}
          {hostsUndergrads && (
            <button
              type="button"
              onClick={onRemoveHostsUndergrads}
              aria-label="Remove Has hosted undergrads before"
              className={chipClassName}
            >
              <span className="min-w-0 truncate">Has hosted undergrads before</span>
              <span aria-hidden="true" className="shrink-0">
                ×
              </span>
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onClearAllFilters}
          className="mt-2 inline-flex min-h-11 items-center justify-center rounded-md border border-[var(--yr-line-strong)] px-3 text-sm font-semibold text-slate-700 hover:bg-[var(--yr-panel-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
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

    {researchAreaSuggestions.length > 0 && (
      <div className="mt-4" aria-label="Related research areas">
        <span className="yr-kicker text-[0.7rem]">Explore a related research area</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {researchAreaSuggestions.map((area) => (
            <button
              key={area}
              type="button"
              onClick={() => onSelectResearchArea(area)}
              className={actionClassName}
            >
              {area}
            </button>
          ))}
        </div>
      </div>
    )}

    <div className="mt-4">
      <button
        type="button"
        onClick={onBrowseAll}
        className="inline-flex min-h-11 items-center justify-center rounded-md border border-[var(--yr-line-strong)] px-3 text-sm font-semibold text-slate-700 hover:bg-[var(--yr-panel-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
      >
        Browse all research homes
      </button>
    </div>
  </section>
);

export default ResearchZeroResultRecovery;
