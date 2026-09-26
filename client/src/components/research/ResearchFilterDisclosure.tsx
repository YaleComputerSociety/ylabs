import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDownIcon, FiltersIcon } from '../shared/icons';

import ActiveFilterChip from './ActiveFilterChip';
import {
  isKnownResearchEntityType,
  researchEntityTypeFilterLabel,
} from '../../utils/researchEntityCopy';

type FacetDistribution = Record<string, Record<string, number>>;

interface FacetOption {
  value: string;
  count?: number;
  label?: string;
}

interface ResearchFilterDisclosureProps {
  facetDistribution: FacetDistribution;
  selectedEntityType: string;
  selectedSchool: string;
  selectedDepartment: string;
  isApplying: boolean;
  hasFacetError: boolean;
  departmentLabel: (value: string) => string;
  onEntityTypeChange: (value: string) => void;
  onSchoolChange: (value: string) => void;
  onDepartmentChange: (value: string) => void;
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
  selectedEntityType,
  selectedSchool,
  selectedDepartment,
  isApplying,
  hasFacetError,
  departmentLabel,
  onEntityTypeChange,
  onSchoolChange,
  onDepartmentChange,
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
  const firstFieldRef = useRef<HTMLSelectElement | null>(null);
  const panelId = useId();

  const positiveEntityTypes = useMemo(
    () =>
      positiveFacetOptions(facetDistribution.entityType)
        .filter((option) => isKnownResearchEntityType(option.value))
        .map((option) => ({ ...option, label: researchEntityTypeFilterLabel(option.value) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [facetDistribution.entityType],
  );
  const positiveSchools = useMemo(
    () => positiveFacetOptions(facetDistribution.school),
    [facetDistribution.school],
  );
  const positiveDepartments = useMemo(
    () => positiveFacetOptions(facetDistribution.departments),
    [facetDistribution.departments],
  );
  const entityTypeOptions = useMemo(
    () => withSelectedOption(positiveEntityTypes, selectedEntityType),
    [positiveEntityTypes, selectedEntityType],
  );
  const schoolOptions = useMemo(
    () => withSelectedOption(positiveSchools, selectedSchool),
    [positiveSchools, selectedSchool],
  );
  const departmentOptions = useMemo(
    () => withSelectedOption(positiveDepartments, selectedDepartment),
    [positiveDepartments, selectedDepartment],
  );
  const showEntityType = positiveEntityTypes.length > 1 || Boolean(selectedEntityType);
  const showSchool = positiveSchools.length > 1 || Boolean(selectedSchool);
  const showDepartment = positiveDepartments.length > 1 || Boolean(selectedDepartment);
  const activeCount =
    Number(Boolean(selectedEntityType)) +
    Number(Boolean(selectedSchool)) +
    Number(Boolean(selectedDepartment));
  const visibleFields = (
    [
      showEntityType && 'entityType',
      showSchool && 'school',
      showDepartment && 'department',
    ] as const
  ).filter((field): field is 'entityType' | 'school' | 'department' => Boolean(field));
  const firstVisibleField = visibleFields[0];
  const visibleFacetKey = visibleFields.join(':');

  const getFocusableElements = () =>
    Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) || [],
    );

  const focusFirstControl = useCallback(() => {
    if (isDesktop) {
      (firstFieldRef.current || closeRef.current)?.focus();
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

  const closeFilters = useCallback(
    (restoreFocus = true) => {
      setIsOpen(false);
      if (restoreFocus) window.setTimeout(() => triggerRef.current?.focus(), 0);
    },
    [setIsOpen],
  );

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
  }, [closeFilters, isOpen, isSidebar]);

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
  }, [closeFilters, isDesktop, isOpen, isSidebar]);

  const emptyMessage = hasFacetError
    ? 'Filter options are temporarily unavailable. Your search still works, and active filters can be cleared.'
    : isApplying
      ? 'Filter options will appear when this search finishes.'
      : 'No additional filters can narrow these results.';

  const facetCountWarning = hasFacetError && visibleFields.length > 0 && (
    <p className="rounded-card border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      Current filter counts are unavailable. Active values remain clearable.
    </p>
  );

  const filterFields = (
    <fieldset className="min-w-0 border-0 p-0">
      <legend className="sr-only">Narrow research results</legend>
      <div className="min-w-0 space-y-4">
        {showEntityType && (
          <label className="block min-w-0 text-sm font-medium text-ink">
            Type
            <select
              ref={firstVisibleField === 'entityType' ? firstFieldRef : undefined}
              aria-label="Filter by type"
              value={selectedEntityType}
              onChange={(event) => onEntityTypeChange(event.target.value)}
              className="yr-focus-ring mt-1 min-h-11 w-full min-w-0 rounded-control border border-[var(--yr-line-strong)] bg-white px-3 text-base text-ink"
            >
              <option value="">All types</option>
              {entityTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label || researchEntityTypeFilterLabel(option.value)}
                  {option.count !== undefined ? ` (${option.count})` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        {showSchool && (
          <label className="block min-w-0 text-sm font-medium text-ink">
            School
            <select
              ref={firstVisibleField === 'school' ? firstFieldRef : undefined}
              aria-label="Filter by school"
              value={selectedSchool}
              onChange={(event) => onSchoolChange(event.target.value)}
              className="yr-focus-ring mt-1 min-h-11 w-full min-w-0 rounded-control border border-[var(--yr-line-strong)] bg-white px-3 text-base text-ink"
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
          <label className="block min-w-0 text-sm font-medium text-ink">
            Department
            <select
              ref={firstVisibleField === 'department' ? firstFieldRef : undefined}
              aria-label="Filter by department"
              value={selectedDepartment}
              onChange={(event) => onDepartmentChange(event.target.value)}
              className="yr-focus-ring mt-1 min-h-11 w-full min-w-0 rounded-control border border-[var(--yr-line-strong)] bg-white px-3 text-base text-ink"
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
        {visibleFields.length === 0 && (
          <p className="text-sm leading-relaxed text-muted">{emptyMessage}</p>
        )}
      </div>
    </fieldset>
  );

  const clearAllButton = activeCount > 0 && (
    <button
      type="button"
      onClick={onClearAll}
      className="yr-focus-ring inline-flex min-h-11 w-full items-center justify-center rounded-card border border-[var(--yr-line-strong)] px-3 text-sm font-semibold text-ink-soft hover:bg-[var(--yr-panel-muted)]"
    >
      Clear all filters
    </button>
  );

  const activeChips = activeCount > 0 && (
    <div
      className="mt-2 flex min-w-0 max-w-full flex-wrap gap-2"
      aria-label="Active research filters"
    >
      {selectedEntityType && (
        <ActiveFilterChip
          axis="Type"
          value={researchEntityTypeFilterLabel(selectedEntityType)}
          onRemove={() => onEntityTypeChange('')}
        />
      )}
      {selectedSchool && (
        <ActiveFilterChip
          axis="School"
          value={selectedSchool}
          onRemove={() => onSchoolChange('')}
        />
      )}
      {selectedDepartment && (
        <ActiveFilterChip
          axis="Department"
          value={departmentLabel(selectedDepartment)}
          onRemove={() => onDepartmentChange('')}
        />
      )}
      <button
        type="button"
        onClick={onClearAll}
        className="yr-focus-ring inline-flex min-h-11 shrink-0 items-center rounded-control px-2 text-sm font-semibold text-muted hover:text-ink"
      >
        Clear all active filters
      </button>
    </div>
  );

  if (isSidebar) {
    return (
      <section aria-label="Research filters" aria-busy={isApplying} className="min-w-0 max-w-full">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-ink">Research filters</h2>
          {activeCount > 0 && (
            <span className="min-w-5 rounded-full bg-[var(--yr-blue)] px-1.5 py-0.5 text-center text-xs font-semibold text-white">
              {activeCount}
            </span>
          )}
        </div>
        {isApplying && (
          <p role="status" className="mt-1 text-xs text-muted">
            Applying filters…
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
          className="yr-focus-ring inline-flex min-h-11 max-w-full items-center gap-2 rounded-card border border-[var(--yr-line-strong)] bg-[var(--yr-panel)] px-3 text-sm font-semibold text-ink-soft transition-colors hover:bg-[var(--yr-panel-muted)]"
        >
          <FiltersIcon className="h-4 w-4 shrink-0" />
          <span>Filters</span>
          {activeCount > 0 && (
            <span className="min-w-5 rounded-full bg-[var(--yr-blue)] px-1.5 py-0.5 text-center text-xs font-semibold text-white">
              {activeCount}
            </span>
          )}
          <ChevronDownIcon
            className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {isOpen && (
          <>
            <div
              data-testid="research-filter-backdrop"
              aria-hidden="true"
              onMouseDown={() => closeFilters()}
              className="fixed inset-0 z-40 bg-[var(--yr-navy)]/30 sm:hidden"
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
              className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] w-full max-w-full overflow-y-auto rounded-t-md border border-[var(--yr-line)] bg-[var(--yr-panel)] shadow-yr-overlay sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-1 sm:w-[22rem] sm:max-w-[calc(100vw-2rem)] sm:rounded-overlay"
            >
              <div className="flex min-w-0 items-center justify-between gap-3 border-b border-[var(--yr-line)] px-4 py-3">
                <div className="min-w-0">
                  <h3 className="truncate text-base font-semibold text-ink">Research filters</h3>
                  {isApplying && (
                    <p role="status" className="mt-0.5 text-xs text-muted">
                      Applying filters…
                    </p>
                  )}
                </div>
                <button
                  ref={closeRef}
                  type="button"
                  aria-label="Close filters"
                  onClick={() => closeFilters()}
                  className="yr-focus-ring inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-card text-2xl text-muted hover:bg-[var(--yr-panel-muted)]"
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
