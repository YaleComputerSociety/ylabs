import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import ResearchAreaTypeahead from './ResearchAreaTypeahead';

type FacetDistribution = Record<string, Record<string, number>>;

interface FacetOption {
  value: string;
  count?: number;
  label?: string;
}

interface ResearchFilterDisclosureProps {
  facetDistribution: FacetDistribution;
  selectedSchool: string;
  selectedDepartment: string;
  selectedResearchAreas: string[];
  researchAreaOptions: FacetOption[];
  hostsUndergrads: boolean;
  currentAvailabilityOptions: FacetOption[];
  selectedCurrentAvailability: string[];
  isApplying: boolean;
  hasFacetError: boolean;
  departmentLabel: (value: string) => string;
  onSchoolChange: (value: string) => void;
  onDepartmentChange: (value: string) => void;
  onResearchAreasChange: (value: string[]) => void;
  onHostsUndergradsChange: (value: boolean) => void;
  onCurrentAvailabilityChange: (value: string[]) => void;
  onClearAll: () => void;
  variant?: 'popover' | 'sidebar';
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const positiveFacetOptions = (values: Record<string, number> | undefined): FacetOption[] =>
  Object.entries(values || {})
    .filter(([value, count]) => value.trim().length > 0 && Number.isFinite(count) && count > 0)
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => a.value.localeCompare(b.value));

const withSelectedOption = (options: FacetOption[], selected: string): FacetOption[] => {
  if (!selected || options.some((option) => option.value === selected)) return options;
  return [{ value: selected }, ...options];
};

const ResearchFilterDisclosure = ({
  facetDistribution,
  selectedSchool,
  selectedDepartment,
  selectedResearchAreas,
  researchAreaOptions,
  hostsUndergrads,
  currentAvailabilityOptions,
  selectedCurrentAvailability,
  isApplying,
  hasFacetError,
  departmentLabel,
  onSchoolChange,
  onDepartmentChange,
  onResearchAreasChange,
  onHostsUndergradsChange,
  onCurrentAvailabilityChange,
  onClearAll,
  variant = 'popover',
  isOpen: controlledIsOpen,
  onOpenChange,
}: ResearchFilterDisclosureProps) => {
  const isSidebar = variant === 'sidebar';
  const [uncontrolledIsOpen, setUncontrolledIsOpen] = useState(false);
  const isControlledOpen = controlledIsOpen !== undefined;
  const isOpen = isControlledOpen ? controlledIsOpen : uncontrolledIsOpen;
  const setIsOpen = useCallback(
    (next: boolean) => {
      if (!isControlledOpen) setUncontrolledIsOpen(next);
      onOpenChange?.(next);
    },
    [isControlledOpen, onOpenChange],
  );
  const [isDesktop, setIsDesktop] = useState(
    () => window.matchMedia?.('(min-width: 640px)').matches ?? false,
  );
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const firstControlRef = useRef<HTMLInputElement | null>(null);
  const firstSchoolRef = useRef<HTMLSelectElement | null>(null);
  const firstDepartmentRef = useRef<HTMLSelectElement | null>(null);
  const panelId = useId();

  const positiveSchools = useMemo(
    () => positiveFacetOptions(facetDistribution.school),
    [facetDistribution.school],
  );
  const positiveDepartments = useMemo(
    () => positiveFacetOptions(facetDistribution.departments),
    [facetDistribution.departments],
  );
  const schoolOptions = useMemo(
    () => withSelectedOption(positiveSchools, selectedSchool),
    [positiveSchools, selectedSchool],
  );
  const departmentOptions = useMemo(
    () => withSelectedOption(positiveDepartments, selectedDepartment),
    [positiveDepartments, selectedDepartment],
  );
  const availableResearchAreas = useMemo(
    () => researchAreaOptions.filter((option) => !selectedResearchAreas.includes(option.value)),
    [researchAreaOptions, selectedResearchAreas],
  );
  const showSchool = positiveSchools.length > 1 || Boolean(selectedSchool);
  const showDepartment = positiveDepartments.length > 1 || Boolean(selectedDepartment);
  const showResearchAreas = availableResearchAreas.length > 0 || selectedResearchAreas.length > 0;
  const showCurrentAvailability =
    currentAvailabilityOptions.length > 0 || selectedCurrentAvailability.length > 0;
  const activeCount =
    Number(Boolean(selectedSchool)) +
    Number(Boolean(selectedDepartment)) +
    selectedResearchAreas.length +
    Number(hostsUndergrads) +
    selectedCurrentAvailability.length;
  const visibleFacetKey = `${String(showSchool)}:${String(showDepartment)}`;
  const toggleCurrentAvailability = (value: string, checked: boolean) => {
    onCurrentAvailabilityChange(
      checked
        ? [...selectedCurrentAvailability, value]
        : selectedCurrentAvailability.filter((selected) => selected !== value),
    );
  };

  const getFocusableElements = () =>
    Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) || [],
    );

  const focusFirstControl = useCallback(() => {
    if (isDesktop) {
      (
        firstControlRef.current ||
        firstSchoolRef.current ||
        firstDepartmentRef.current ||
        closeRef.current
      )?.focus();
      return;
    }
    closeRef.current?.focus();
  }, [isDesktop]);

  useEffect(() => {
    const mediaQuery = window.matchMedia?.('(min-width: 640px)');
    if (!mediaQuery) return;
    const handleChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    setIsDesktop(mediaQuery.matches);
    mediaQuery.addEventListener?.('change', handleChange);
    return () => mediaQuery.removeEventListener?.('change', handleChange);
  }, []);

  const closeFilters = (restoreFocus = true) => {
    setIsOpen(false);
    if (restoreFocus) window.setTimeout(() => triggerRef.current?.focus(), 0);
  };

  useEffect(() => {
    if (isSidebar || !isOpen) return;
    const timeout = window.setTimeout(focusFirstControl, 0);
    return () => window.clearTimeout(timeout);
  }, [focusFirstControl, isOpen, isSidebar]);

  useEffect(() => {
    if (isSidebar || !isOpen) return;
    const timeout = window.setTimeout(() => {
      if (!panelRef.current?.contains(document.activeElement)) focusFirstControl();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [focusFirstControl, isOpen, isSidebar, visibleFacetKey]);

  useEffect(() => {
    if (isSidebar || !isOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeFilters();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, isSidebar]);

  useEffect(() => {
    if (isSidebar || !isOpen) return;
    const handlePointerOutside = (event: MouseEvent) => {
      if (!isDesktop) return;
      if (
        panelRef.current?.contains(event.target as Node) ||
        triggerRef.current?.contains(event.target as Node)
      ) {
        return;
      }
      closeFilters(false);
    };
    document.addEventListener('mousedown', handlePointerOutside);
    return () => document.removeEventListener('mousedown', handlePointerOutside);
  }, [isDesktop, isOpen, isSidebar]);

  const emptyMessage = hasFacetError
    ? 'Filter options are temporarily unavailable. Your search still works, and active filters can be cleared.'
    : isApplying
      ? 'Filter options will appear when this search finishes.'
      : 'No additional filters can narrow these results.';

  const facetCountWarning = hasFacetError && (showSchool || showDepartment || showCurrentAvailability) && (
    <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      Current filter counts are unavailable. Active values remain clearable.
    </p>
  );

  const filterFields = (
    <fieldset className="min-w-0 space-y-4 border-0 p-0">
      <legend className="sr-only">Narrow research results</legend>
      <label className="flex min-w-0 items-start gap-2 text-sm font-medium text-slate-800">
        <input
          ref={firstControlRef}
          type="checkbox"
          checked={hostsUndergrads}
          onChange={(event) => onHostsUndergradsChange(event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-[var(--yr-line-strong)] text-blue-700 focus:ring-blue-200"
        />
        <span>Has hosted undergrads before</span>
      </label>
      {showCurrentAvailability && (
        <fieldset className="min-w-0 space-y-2 border-0 p-0">
          <legend className="text-sm font-medium text-slate-800">
            Current undergraduate availability
          </legend>
          {currentAvailabilityOptions.map((option) => (
            <label
              key={option.value}
              className="flex min-w-0 items-start gap-2 text-sm text-slate-800"
            >
              <input
                type="checkbox"
                checked={selectedCurrentAvailability.includes(option.value)}
                onChange={(event) => toggleCurrentAvailability(option.value, event.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-[var(--yr-line-strong)] text-blue-700 focus:ring-blue-200"
              />
              <span>
                {option.label ?? option.value}
                {option.count !== undefined ? ` (${option.count})` : ''}
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {showResearchAreas && (
        <ResearchAreaTypeahead
          options={availableResearchAreas}
          hasSelections={selectedResearchAreas.length > 0}
          onSelect={(value) => onResearchAreasChange([...selectedResearchAreas, value])}
        />
      )}
      {showSchool && (
        <label className="block min-w-0 text-sm font-medium text-slate-800">
          School
          <select
            ref={firstSchoolRef}
            aria-label="Filter by school"
            value={selectedSchool}
            onChange={(event) => onSchoolChange(event.target.value)}
            className="mt-1 min-h-11 w-full min-w-0 rounded-md border border-[var(--yr-line-strong)] bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
          >
            <option value="">All schools</option>
            {schoolOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.value}
                {option.count !== undefined ? ` (${option.count})` : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      {showDepartment && (
        <label className="block min-w-0 text-sm font-medium text-slate-800">
          Department
          <select
            ref={!showSchool ? firstDepartmentRef : undefined}
            aria-label="Filter by department"
            value={selectedDepartment}
            onChange={(event) => onDepartmentChange(event.target.value)}
            className="mt-1 min-h-11 w-full min-w-0 rounded-md border border-[var(--yr-line-strong)] bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
          >
            <option value="">All departments</option>
            {departmentOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {departmentLabel(option.value)}
                {option.count !== undefined ? ` (${option.count})` : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      {!showSchool && !showDepartment && !showResearchAreas && !showCurrentAvailability && (
        <p className="text-sm leading-relaxed text-slate-600">{emptyMessage}</p>
      )}
    </fieldset>
  );

  const clearAllButton = activeCount > 0 && (
    <button
      type="button"
      onClick={onClearAll}
      className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-[var(--yr-line-strong)] px-3 text-sm font-semibold text-slate-700 hover:bg-[var(--yr-panel-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
    >
      Clear all filters
    </button>
  );

  const activeChips = activeCount > 0 && (
    <div
      className="mt-2 flex min-w-0 max-w-full flex-wrap gap-2"
      aria-label="Active research filters"
    >
      {selectedSchool && (
        <button
          type="button"
          onClick={() => onSchoolChange('')}
          aria-label={`Remove School: ${selectedSchool}`}
          className="inline-flex min-h-11 max-w-full min-w-0 items-center gap-2 rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] px-3 text-sm text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
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
          onClick={() => onDepartmentChange('')}
          aria-label={`Remove Department: ${departmentLabel(selectedDepartment)}`}
          className="inline-flex min-h-11 max-w-full min-w-0 items-center gap-2 rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] px-3 text-sm text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
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
          onClick={() => onResearchAreasChange(selectedResearchAreas.filter((a) => a !== area))}
          aria-label={`Remove Research area: ${area}`}
          className="inline-flex min-h-11 max-w-full min-w-0 items-center gap-2 rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] px-3 text-sm text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
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
          onClick={() => onHostsUndergradsChange(false)}
          aria-label="Remove Has hosted undergrads before"
          className="inline-flex min-h-11 max-w-full min-w-0 items-center gap-2 rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] px-3 text-sm text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
        >
          <span className="min-w-0 truncate">Has hosted undergrads before</span>
          <span aria-hidden="true" className="shrink-0">
            ×
          </span>
        </button>
      )}
      {selectedCurrentAvailability.map((value) => {
        const label =
          currentAvailabilityOptions.find((option) => option.value === value)?.label ?? value;
        return (
          <button
            key={value}
            type="button"
            onClick={() =>
              onCurrentAvailabilityChange(
                selectedCurrentAvailability.filter((selected) => selected !== value),
              )
            }
            aria-label={`Remove ${label}`}
            className="inline-flex min-h-11 max-w-full min-w-0 items-center gap-2 rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] px-3 text-sm text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
          >
            <span className="min-w-0 truncate">{label}</span>
            <span aria-hidden="true" className="shrink-0">
              ×
            </span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={onClearAll}
        className="inline-flex min-h-11 shrink-0 items-center rounded-md px-2 text-sm font-semibold text-slate-600 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
      >
        Clear all active filters
      </button>
    </div>
  );

  if (isSidebar) {
    return (
      <section aria-label="Research filters" aria-busy={isApplying} className="min-w-0 max-w-full">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-950">Research filters</h2>
          {activeCount > 0 && (
            <span className="min-w-5 rounded-full bg-[var(--yr-blue)] px-1.5 py-0.5 text-center text-xs font-semibold text-white">
              {activeCount}
            </span>
          )}
        </div>
        {isApplying && (
          <p role="status" className="mt-1 text-xs text-slate-600">
            Applying filters...
          </p>
        )}
        <div className="mt-4 min-w-0 space-y-4">
          {facetCountWarning}
          {filterFields}
          {clearAllButton}
        </div>
        {activeChips}
      </section>
    );
  }

  return (
    <div className="mt-3 min-w-0 max-w-full">
      <div className="relative min-w-0 max-w-full">
        <button
          ref={triggerRef}
          type="button"
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          aria-controls={isOpen ? panelId : undefined}
          aria-label={`Filters${activeCount > 0 ? `, ${activeCount} active` : ''}`}
          onClick={() => (isOpen ? closeFilters() : setIsOpen(true))}
          className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-md border border-[var(--yr-line-strong)] bg-[var(--yr-panel)] px-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-[var(--yr-panel-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
        >
          <svg
            aria-hidden="true"
            className="h-4 w-4 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M3 5h18M6 12h12M10 19h4"
            />
          </svg>
          <span>Filters</span>
          {activeCount > 0 && (
            <span className="min-w-5 rounded-full bg-[var(--yr-blue)] px-1.5 py-0.5 text-center text-xs font-semibold text-white">
              {activeCount}
            </span>
          )}
          <svg
            aria-hidden="true"
            className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path d="M5.2 7.5 10 12.3l4.8-4.8 1.4 1.4-6.2 6.2-6.2-6.2 1.4-1.4Z" />
          </svg>
        </button>

        {isOpen && (
          <>
            <div
              data-testid="research-filter-backdrop"
              aria-hidden="true"
              onMouseDown={() => closeFilters()}
              className="fixed inset-0 z-40 bg-slate-950/30 sm:hidden"
            />
            <div
              id={panelId}
              ref={panelRef}
              role="dialog"
              aria-modal={isDesktop ? undefined : true}
              aria-label="Research filters"
              aria-busy={isApplying}
              onKeyDown={(event) => {
                if (isDesktop || event.key !== 'Tab') return;
                const focusable = getFocusableElements();
                if (focusable.length === 0) return;
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first.focus();
                }
              }}
              className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] w-full max-w-full overflow-y-auto rounded-t-md border border-[var(--yr-line)] bg-[var(--yr-panel)] shadow-lg sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-1 sm:w-[22rem] sm:max-w-[calc(100vw-2rem)] sm:rounded-md"
            >
              <div className="flex min-w-0 items-center justify-between gap-3 border-b border-[var(--yr-line)] px-4 py-3">
                <div className="min-w-0">
                  <h3 className="truncate text-base font-semibold text-slate-950">
                    Research filters
                  </h3>
                  {isApplying && (
                    <p role="status" className="mt-0.5 text-xs text-slate-600">
                      Applying filters...
                    </p>
                  )}
                </div>
                <button
                  ref={closeRef}
                  type="button"
                  aria-label="Close filters"
                  onClick={() => closeFilters()}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-2xl text-slate-600 hover:bg-[var(--yr-panel-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>

              <div className="min-w-0 space-y-4 p-4">
                {facetCountWarning}
                {filterFields}
                {clearAllButton}
              </div>
            </div>
          </>
        )}
      </div>

      {activeChips}
    </div>
  );
};

export default ResearchFilterDisclosure;
