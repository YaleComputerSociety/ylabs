import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDownIcon, CloseIcon, FiltersIcon } from '../shared/icons';

import ActiveFilterChip from './ActiveFilterChip';
import {
  HOSTED_UNDERGRADUATES_CHIP_VALUE,
  HOSTED_UNDERGRADUATES_LABEL,
  NO_HOSTED_UNDERGRADUATE_EVIDENCE_NOTE,
  isKnownResearchEntityType,
  researchEntityTypeFilterLabel,
} from '../../utils/researchEntityCopy';
import useMediaQuery from '../../hooks/useMediaQuery';

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
  selectedHostsUndergrads?: boolean;
  isApplying: boolean;
  hasFacetError: boolean;
  departmentLabel: (value: string) => string;
  onEntityTypeChange: (value: string) => void;
  onSchoolChange: (value: string) => void;
  onDepartmentChange: (value: string) => void;
  onHostsUndergradsChange?: (value: boolean) => void;
  onClearAll: () => void;
  variant?: 'popover' | 'sidebar';
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  operatorControls?: ReactNode;
  operatorActiveCount?: number;
  resultCount?: number;
  resultCountPending?: boolean;
  onShowResults?: () => void;
  isLoadingOptions?: boolean;
}

const resultCountFormatter = new Intl.NumberFormat('en-US');

const showResultsLabel = (count: number | undefined): string =>
  count === undefined
    ? 'Show results'
    : `Show ${resultCountFormatter.format(count)} ${count === 1 ? 'result' : 'results'}`;

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
  selectedHostsUndergrads = false,
  isApplying,
  hasFacetError,
  departmentLabel,
  onEntityTypeChange,
  onSchoolChange,
  onDepartmentChange,
  onHostsUndergradsChange,
  onClearAll,
  variant = 'popover',
  isOpen: controlledIsOpen,
  onOpenChange,
  operatorControls,
  operatorActiveCount = 0,
  resultCount,
  resultCountPending = false,
  onShowResults,
  isLoadingOptions = false,
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
  const isDesktop = useMediaQuery('(min-width: 640px)');
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const firstFieldRef = useRef<HTMLElement | null>(null);
  const setFirstFieldNode = useCallback((node: HTMLElement | null) => {
    firstFieldRef.current = node;
  }, []);
  const panelId = useId();
  const hostsUndergradsNoteId = useId();

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
  const showEntityType = positiveEntityTypes.length > 0 || Boolean(selectedEntityType);
  const showSchool = positiveSchools.length > 0 || Boolean(selectedSchool);
  const showDepartment = positiveDepartments.length > 0 || Boolean(selectedDepartment);
  const servedHostsUndergradsCount = facetDistribution.hostsUndergrads?.true;
  const hostsUndergradsCount = Number.isFinite(servedHostsUndergradsCount)
    ? servedHostsUndergradsCount
    : undefined;
  const noHostedUndergraduateEvidence = hostsUndergradsCount === 0 && !selectedHostsUndergrads;
  const showHostsUndergrads =
    Boolean(onHostsUndergradsChange) &&
    (hostsUndergradsCount !== undefined || selectedHostsUndergrads);
  const activeCount =
    Number(Boolean(selectedEntityType)) +
    Number(Boolean(selectedSchool)) +
    Number(Boolean(selectedDepartment)) +
    Number(selectedHostsUndergrads);
  const triggerCount = activeCount + operatorActiveCount;
  const visibleFields = (
    [
      showHostsUndergrads && 'hostsUndergrads',
      showEntityType && 'entityType',
      showSchool && 'school',
      showDepartment && 'department',
    ] as const
  ).filter((field): field is 'entityType' | 'school' | 'department' | 'hostsUndergrads' =>
    Boolean(field),
  );
  const firstVisibleField = visibleFields.find(
    (field) => field !== 'hostsUndergrads' || !noHostedUndergraduateEvidence,
  );
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
    ? 'Filter options could not load with this search. Active filters can still be cleared.'
    : isApplying || isLoadingOptions
      ? 'Filter options will appear when this search finishes.'
      : 'No additional filters can narrow these results.';

  const facetCountWarning = hasFacetError && visibleFields.length > 0 && (
    <p className="rounded-card border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      Current filter counts are unavailable. Active values remain clearable.
    </p>
  );

  const selectFieldLabelClassName = isSidebar
    ? 'grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-2 text-sm font-medium text-ink'
    : 'block min-w-0 text-sm font-medium text-ink';
  const selectClassName = `yr-focus-ring ${isSidebar ? '' : 'mt-1 '}min-h-11 w-full min-w-0 rounded-control border border-[var(--yr-line-control)] bg-white px-3 text-base text-ink`;

  const filterFields = (
    <fieldset className="min-w-0 border-0 p-0">
      <legend className="sr-only">Narrow research results</legend>
      <div className="min-w-0 space-y-4">
        {showHostsUndergrads && (
          <div className="min-w-0">
            <label className="flex min-h-11 min-w-0 items-start gap-3 text-sm font-medium text-ink">
              <input
                ref={firstVisibleField === 'hostsUndergrads' ? setFirstFieldNode : undefined}
                type="checkbox"
                checked={selectedHostsUndergrads}
                disabled={noHostedUndergraduateEvidence}
                aria-describedby={noHostedUndergraduateEvidence ? hostsUndergradsNoteId : undefined}
                onChange={(event) => onHostsUndergradsChange?.(event.target.checked)}
                className="yr-focus-ring mt-0.5 h-5 w-5 shrink-0 rounded-control border-[var(--yr-line-strong)] accent-brand disabled:cursor-not-allowed"
              />
              <span className={`min-w-0 ${noHostedUndergraduateEvidence ? 'text-muted' : ''}`}>
                {HOSTED_UNDERGRADUATES_LABEL}
                {hostsUndergradsCount !== undefined ? ` (${hostsUndergradsCount})` : ''}
              </span>
            </label>
            {noHostedUndergraduateEvidence && (
              <p id={hostsUndergradsNoteId} className="ml-8 text-xs leading-relaxed text-muted">
                {NO_HOSTED_UNDERGRADUATE_EVIDENCE_NOTE}
              </p>
            )}
          </div>
        )}
        {showEntityType && (
          <label className={selectFieldLabelClassName}>
            Type
            <select
              ref={firstVisibleField === 'entityType' ? setFirstFieldNode : undefined}
              aria-label="Filter by type"
              value={selectedEntityType}
              onChange={(event) => onEntityTypeChange(event.target.value)}
              className={selectClassName}
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
          <label className={selectFieldLabelClassName}>
            School
            <select
              ref={firstVisibleField === 'school' ? setFirstFieldNode : undefined}
              aria-label="Filter by school"
              value={selectedSchool}
              onChange={(event) => onSchoolChange(event.target.value)}
              className={selectClassName}
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
          <label className={selectFieldLabelClassName}>
            Department
            <select
              ref={firstVisibleField === 'department' ? setFirstFieldNode : undefined}
              aria-label="Filter by department"
              value={selectedDepartment}
              onChange={(event) => onDepartmentChange(event.target.value)}
              className={selectClassName}
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

  const activeChips = (besideTrigger: boolean) =>
    activeCount > 0 && (
      <div
        className={
          besideTrigger
            ? 'flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-x-auto *:max-w-[16rem] *:shrink-0'
            : 'mt-2 flex min-w-0 max-w-full flex-wrap gap-2'
        }
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
        {selectedHostsUndergrads && (
          <ActiveFilterChip
            axis="Undergraduates"
            value={HOSTED_UNDERGRADUATES_CHIP_VALUE}
            onRemove={() => onHostsUndergradsChange?.(false)}
          />
        )}
        {besideTrigger && (
          <button
            type="button"
            onClick={onClearAll}
            className="yr-focus-ring inline-flex min-h-11 shrink-0 items-center rounded-control px-2 text-sm font-semibold text-muted hover:text-ink"
          >
            Clear all filters
          </button>
        )}
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
        {activeChips(false)}
      </section>
    );
  }

  return (
    <div className="mt-3 flex min-w-0 max-w-full items-center gap-2">
      <div className="relative min-w-0 max-w-full shrink-0">
        <button
          ref={triggerRef}
          type="button"
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          aria-controls={isOpen ? panelId : undefined}
          aria-label={`Filters${triggerCount > 0 ? `, ${triggerCount} active` : ''}`}
          onClick={() => (isOpen ? closeFilters() : setIsOpen(true))}
          className="yr-focus-ring inline-flex min-h-11 max-w-full items-center gap-2 rounded-card border border-[var(--yr-line-strong)] bg-[var(--yr-panel)] px-3 text-sm font-semibold text-ink-soft transition-colors hover:bg-[var(--yr-panel-muted)]"
        >
          <FiltersIcon className="h-4 w-4 shrink-0" />
          <span>Filters</span>
          {triggerCount > 0 && (
            <span className="min-w-5 rounded-full bg-[var(--yr-blue)] px-1.5 py-0.5 text-center text-xs font-semibold text-white">
              {triggerCount}
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
              className="fixed inset-0 z-40 bg-scrim sm:hidden"
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
              className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] w-full max-w-full overflow-y-auto rounded-t-overlay border border-[var(--yr-line)] bg-[var(--yr-panel)] shadow-yr-overlay sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-1 sm:w-[22rem] sm:max-w-[calc(100vw-2rem)] sm:rounded-overlay"
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
                  className="yr-focus-ring inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-card text-muted hover:bg-[var(--yr-panel-muted)] hover:text-ink-soft"
                >
                  <CloseIcon size={20} />
                </button>
              </div>

              <div className="min-w-0 space-y-4 p-4">
                {facetCountWarning}
                {filterFields}
                {clearAllButton}
                {operatorControls && (
                  <section
                    aria-labelledby={`${panelId}-operator-controls`}
                    className="grid gap-3 border-t border-[var(--yr-line)] pt-4"
                  >
                    <h4
                      id={`${panelId}-operator-controls`}
                      className="text-sm font-semibold text-ink"
                    >
                      Operator controls
                    </h4>
                    {operatorControls}
                  </section>
                )}
              </div>
              <div className="sticky bottom-0 border-t border-[var(--yr-line)] bg-[var(--yr-panel)] px-4 py-3">
                <button
                  type="button"
                  onClick={() => {
                    closeFilters();
                    onShowResults?.();
                  }}
                  className="yr-focus-ring yr-pressable grid min-h-11 w-full place-items-center rounded-control bg-[var(--yr-blue)] px-4 text-sm font-semibold text-white hover:bg-brand-navy"
                >
                  <span
                    aria-hidden={resultCountPending || undefined}
                    className={`yr-num col-start-1 row-start-1 ${resultCountPending ? 'invisible' : ''}`}
                  >
                    {showResultsLabel(resultCount)}
                  </span>
                  <span
                    aria-hidden={resultCountPending ? undefined : true}
                    className={`col-start-1 row-start-1 ${resultCountPending ? '' : 'invisible'}`}
                  >
                    Updating results…
                  </span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {activeChips(true)}
    </div>
  );
};

export default ResearchFilterDisclosure;
