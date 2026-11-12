import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDownIcon, CloseIcon, FiltersIcon } from '../shared/icons';

import ActiveFilterChip from './ActiveFilterChip';
import {
  ADVISES_UNDERGRAD_RESEARCH_FILTER_HINT,
  ADVISES_UNDERGRAD_RESEARCH_FILTER_LABEL,
  HAS_HAD_UNDERGRADS_FILTER_LABEL,
  NO_HOSTED_UNDERGRADUATE_EVIDENCE_NOTE,
  TAKING_UNDERGRADS_NOW_FILTER_LABEL,
  UNDERGRADS_FILTER_COMBINATION_NOTE,
  UNDERGRADS_FILTER_GROUP_LABEL,
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
  selectedWelcomesUndergrads?: boolean;
  selectedMentorsUndergrads?: boolean;
  isApplying: boolean;
  hasFacetError: boolean;
  departmentLabel: (value: string) => string;
  onEntityTypeChange: (value: string) => void;
  onSchoolChange: (value: string) => void;
  onDepartmentChange: (value: string) => void;
  onHostsUndergradsChange?: (value: boolean) => void;
  onWelcomesUndergradsChange?: (value: boolean) => void;
  onMentorsUndergradsChange?: (value: boolean) => void;
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
  trailingControl?: ReactNode;
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

const servedTrueCount = (facet: Record<string, number> | undefined): number | undefined =>
  Number.isFinite(facet?.true) ? facet?.true : undefined;

interface UndergraduateToggleProps {
  label: string;
  hint?: string;
  count: number | undefined;
  countSuffix: string;
  checked: boolean;
  noEvidenceNoteId: string;
  inputRef?: (node: HTMLElement | null) => void;
  onChange?: (value: boolean) => void;
}

const UndergraduateToggle = ({
  label,
  hint,
  count,
  countSuffix,
  checked,
  noEvidenceNoteId,
  inputRef,
  onChange,
}: UndergraduateToggleProps) => {
  const hintId = useId();
  const noEvidence = count === 0 && !checked;
  const describedBy =
    [hint ? hintId : null, noEvidence ? noEvidenceNoteId : null].filter(Boolean).join(' ') ||
    undefined;
  return (
    <div className="min-w-0">
      <label className="flex min-h-11 min-w-0 items-center gap-3 text-sm font-medium text-ink">
        <input
          ref={inputRef}
          type="checkbox"
          checked={checked}
          disabled={noEvidence}
          aria-describedby={describedBy}
          onChange={(event) => onChange?.(event.target.checked)}
          className="yr-focus-ring h-5 w-5 shrink-0 rounded-control border-[var(--yr-line-strong)] accent-brand disabled:cursor-not-allowed"
        />
        <span className={`yr-num min-w-0 ${noEvidence ? 'text-muted' : ''}`}>
          {label}
          {countSuffix}
        </span>
      </label>
      {hint && (
        <p id={hintId} className="-mt-3 ml-8 text-xs leading-snug text-muted">
          {hint}
        </p>
      )}
    </div>
  );
};

// Clearing every filter removes the control the student pressed, and with no query the
// page swaps to the browse view, which mounts a new filter bar, so the target is looked
// up after that render rather than held as a ref.
export const focusResearchFiltersEntry = () => {
  window.setTimeout(() => {
    document.querySelector<HTMLElement>('[data-research-filters-entry]')?.focus();
  }, 0);
};

const KEYS_THAT_STEP_A_CLOSED_SELECT = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

const keyStepsAClosedSelect = (key: string): boolean =>
  key.length === 1 || KEYS_THAT_STEP_A_CLOSED_SELECT.has(key);

const keyOpensASelectList = ({ key, altKey }: { key: string; altKey: boolean }): boolean =>
  key === 'F4' || (altKey && (key === 'ArrowDown' || key === 'ArrowUp'));

// Applying a filter from the browse view starts a search, and the page renders the
// search view's own filter controls, so the select the student was on is replaced. The
// replacement is found by its label once that render has landed.
const refocusFilterSelectAfterRender = (ariaLabel: string) => {
  window.setTimeout(() => {
    const active = document.activeElement;
    if (active && active !== document.body) return;
    document
      .querySelector<HTMLSelectElement>(`select[aria-label="${CSS.escape(ariaLabel)}"]`)
      ?.focus();
  }, 0);
};

interface ConfirmedFilterSelectProps {
  value: string;
  onConfirm: (value: string) => void;
  ariaLabel: string;
  className: string;
  selectRef?: (node: HTMLElement | null) => void;
  children: ReactNode;
}

// A closed select changes its value on every typed letter or arrow key, and applying a
// filter per keystroke ran a search for "Early Modern Studies" while a student typed
// "Ec". Keyboard steps only move the draft and Enter applies it. Leaving the field keeps
// the applied value, because an apply on blur from the browse view replaced the filter
// controls under the student's pending Tab or click. A pick from the open list applies,
// so opening the list drops the draft: picking the option the draft showed must still
// differ from the select's value, or the browser fires no change.
const ConfirmedFilterSelect = ({
  value,
  onConfirm,
  ariaLabel,
  className,
  selectRef,
  children,
}: ConfirmedFilterSelectProps) => {
  const [draft, setDraft] = useState(value);
  const [draftSourceValue, setDraftSourceValue] = useState(value);
  if (draftSourceValue !== value) {
    setDraftSourceValue(value);
    setDraft(value);
  }
  const keyboardStepPendingRef = useRef(false);
  const selectNodeRef = useRef<HTMLSelectElement | null>(null);
  const confirm = (next: string) => {
    setDraft(next);
    if (next === value) return;
    const hadFocus = document.activeElement === selectNodeRef.current;
    onConfirm(next);
    if (hadFocus) refocusFilterSelectAfterRender(ariaLabel);
  };
  const markKeyboardStepPending = () => {
    keyboardStepPendingRef.current = true;
    window.setTimeout(() => {
      keyboardStepPendingRef.current = false;
    }, 0);
  };
  return (
    <select
      ref={(node) => {
        selectNodeRef.current = node;
        selectRef?.(node);
      }}
      aria-label={ariaLabel}
      value={draft}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && draft !== value) {
          event.preventDefault();
          confirm(draft);
          return;
        }
        if (event.key === 'Escape' && draft !== value) {
          event.stopPropagation();
          setDraft(value);
          return;
        }
        if (keyOpensASelectList(event)) {
          setDraft(value);
          return;
        }
        if (keyStepsAClosedSelect(event.key)) markKeyboardStepPending();
      }}
      onKeyPress={(event) => {
        if (event.key.length === 1) markKeyboardStepPending();
      }}
      onChange={(event) => {
        if (keyboardStepPendingRef.current) setDraft(event.target.value);
        else confirm(event.target.value);
      }}
      onMouseDown={() => setDraft(value)}
      onBlur={() => setDraft(value)}
      className={className}
    >
      {children}
    </select>
  );
};

const ResearchFilterDisclosure = ({
  facetDistribution,
  selectedEntityType,
  selectedSchool,
  selectedDepartment,
  selectedHostsUndergrads = false,
  selectedWelcomesUndergrads = false,
  selectedMentorsUndergrads = false,
  isApplying,
  hasFacetError,
  departmentLabel,
  onEntityTypeChange,
  onSchoolChange,
  onDepartmentChange,
  onHostsUndergradsChange,
  onWelcomesUndergradsChange,
  onMentorsUndergradsChange,
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
  trailingControl,
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
  const undergradsCombinationNoteId = useId();
  const undergradsNoEvidenceNoteId = useId();

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
  const someUndergradOptionChecked =
    selectedWelcomesUndergrads || selectedHostsUndergrads || selectedMentorsUndergrads;
  const undergradOptions = (
    [
      {
        field: 'welcomesUndergrads',
        label: TAKING_UNDERGRADS_NOW_FILTER_LABEL,
        hint: undefined,
        checked: selectedWelcomesUndergrads,
        onChange: onWelcomesUndergradsChange,
      },
      {
        field: 'hostsUndergrads',
        label: HAS_HAD_UNDERGRADS_FILTER_LABEL,
        hint: undefined,
        checked: selectedHostsUndergrads,
        onChange: onHostsUndergradsChange,
      },
      {
        field: 'mentorsUndergrads',
        label: ADVISES_UNDERGRAD_RESEARCH_FILTER_LABEL,
        hint: ADVISES_UNDERGRAD_RESEARCH_FILTER_HINT,
        checked: selectedMentorsUndergrads,
        onChange: onMentorsUndergradsChange,
      },
    ] as const
  )
    .map((option) => ({ ...option, count: servedTrueCount(facetDistribution[option.field]) }))
    // An option a ticked sibling drives to zero stays in place, disabled, so ticking one
    // never moves the others; with nothing ticked a zero option is hidden, except hosted,
    // which has always shown its zero with the missing-evidence note.
    .filter(
      (option) =>
        Boolean(option.onChange) &&
        (option.checked ||
          Boolean(option.count) ||
          (option.count === 0 &&
            (option.field === 'hostsUndergrads' || someUndergradOptionChecked))),
    );
  const undergradOptionWithoutEvidence = (option: (typeof undergradOptions)[number]) =>
    option.count === 0 && !option.checked;
  const someUndergradOptionLacksEvidence = undergradOptions.some(undergradOptionWithoutEvidence);
  const activeCount =
    Number(Boolean(selectedEntityType)) +
    Number(Boolean(selectedSchool)) +
    Number(Boolean(selectedDepartment)) +
    Number(selectedHostsUndergrads) +
    Number(selectedWelcomesUndergrads) +
    Number(selectedMentorsUndergrads);
  const triggerCount = activeCount + operatorActiveCount;
  type FilterField =
    | 'entityType'
    | 'school'
    | 'department'
    | 'hostsUndergrads'
    | 'welcomesUndergrads'
    | 'mentorsUndergrads';
  const visibleFields: FilterField[] = [
    ...undergradOptions.map((option) => option.field),
    ...(
      [
        showEntityType && 'entityType',
        showSchool && 'school',
        showDepartment && 'department',
      ] as const
    ).filter((field): field is 'entityType' | 'school' | 'department' => Boolean(field)),
  ];
  const firstVisibleField: FilterField | undefined = [
    ...undergradOptions
      .filter((option) => !undergradOptionWithoutEvidence(option))
      .map((option) => option.field),
    ...visibleFields.slice(undergradOptions.length),
  ][0];
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

  const facetCountSuffix = (count: number | undefined): string =>
    hasFacetError || count === undefined ? '' : ` (${count})`;

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
      <div className={`min-w-0 ${isSidebar ? 'space-y-3' : 'space-y-4'}`}>
        {undergradOptions.length > 0 && (
          <fieldset
            aria-describedby={undergradOptions.length > 1 ? undergradsCombinationNoteId : undefined}
            className="min-w-0 border-0 p-0"
          >
            <legend className="text-sm font-semibold text-ink">
              {UNDERGRADS_FILTER_GROUP_LABEL}
            </legend>
            {undergradOptions.length > 1 && (
              <p id={undergradsCombinationNoteId} className="text-xs leading-snug text-muted">
                {UNDERGRADS_FILTER_COMBINATION_NOTE}
              </p>
            )}
            <div className="min-w-0">
              {undergradOptions.map((option) => (
                <UndergraduateToggle
                  key={option.field}
                  label={option.label}
                  hint={option.hint}
                  count={option.count}
                  countSuffix={facetCountSuffix(option.count)}
                  checked={option.checked}
                  noEvidenceNoteId={undergradsNoEvidenceNoteId}
                  inputRef={firstVisibleField === option.field ? setFirstFieldNode : undefined}
                  onChange={option.onChange}
                />
              ))}
            </div>
            {someUndergradOptionLacksEvidence && (
              <p id={undergradsNoEvidenceNoteId} className="mt-1 text-xs leading-snug text-muted">
                {NO_HOSTED_UNDERGRADUATE_EVIDENCE_NOTE}
              </p>
            )}
          </fieldset>
        )}
        {showEntityType && (
          <label className={selectFieldLabelClassName}>
            Type
            <ConfirmedFilterSelect
              selectRef={firstVisibleField === 'entityType' ? setFirstFieldNode : undefined}
              ariaLabel="Filter by type"
              value={selectedEntityType}
              onConfirm={onEntityTypeChange}
              className={selectClassName}
            >
              <option value="">All types</option>
              {entityTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label || researchEntityTypeFilterLabel(option.value)}
                  {facetCountSuffix(option.count)}
                </option>
              ))}
            </ConfirmedFilterSelect>
          </label>
        )}
        {showSchool && (
          <label className={selectFieldLabelClassName}>
            School
            <ConfirmedFilterSelect
              selectRef={firstVisibleField === 'school' ? setFirstFieldNode : undefined}
              ariaLabel="Filter by school"
              value={selectedSchool}
              onConfirm={onSchoolChange}
              className={selectClassName}
            >
              <option value="">All schools</option>
              {schoolOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.value}
                  {facetCountSuffix(option.count)}
                </option>
              ))}
            </ConfirmedFilterSelect>
          </label>
        )}
        {showDepartment && (
          <label className={selectFieldLabelClassName}>
            Department
            <ConfirmedFilterSelect
              selectRef={firstVisibleField === 'department' ? setFirstFieldNode : undefined}
              ariaLabel="Filter by department"
              value={selectedDepartment}
              onConfirm={onDepartmentChange}
              className={selectClassName}
            >
              <option value="">All departments</option>
              {departmentOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {departmentLabel(option.value)}
                  {facetCountSuffix(option.count)}
                </option>
              ))}
            </ConfirmedFilterSelect>
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
      onClick={() => {
        onClearAll();
        window.setTimeout(() => {
          if (panelRef.current?.isConnected) focusFirstControl();
        }, 0);
      }}
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
            ? '-my-1 -ml-1 flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-x-auto p-1 *:max-w-full *:shrink-0'
            : 'mt-2 flex min-w-0 max-w-full flex-wrap gap-2'
        }
        aria-label="Active research filters"
      >
        {selectedEntityType && (
          <ActiveFilterChip
            axis="Type"
            value={researchEntityTypeFilterLabel(selectedEntityType)}
            visibleLabel={
              besideTrigger ? researchEntityTypeFilterLabel(selectedEntityType) : undefined
            }
            onRemove={() => onEntityTypeChange('')}
          />
        )}
        {selectedSchool && (
          <ActiveFilterChip
            axis="School"
            value={selectedSchool}
            visibleLabel={besideTrigger ? selectedSchool : undefined}
            onRemove={() => onSchoolChange('')}
          />
        )}
        {selectedDepartment && (
          <ActiveFilterChip
            axis="Department"
            value={departmentLabel(selectedDepartment)}
            visibleLabel={besideTrigger ? departmentLabel(selectedDepartment) : undefined}
            onRemove={() => onDepartmentChange('')}
          />
        )}
        {undergradOptions
          .filter((option) => option.checked)
          .map((option) => (
            <ActiveFilterChip
              key={option.field}
              axis={UNDERGRADS_FILTER_GROUP_LABEL}
              value={option.label}
              visibleLabel={besideTrigger ? option.label : undefined}
              onRemove={() => option.onChange?.(false)}
            />
          ))}
        {besideTrigger && (
          <button
            type="button"
            onClick={() => {
              onClearAll();
              focusResearchFiltersEntry();
            }}
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
        <div className="flex min-w-0 items-center gap-3">
          <h2
            data-research-filters-entry=""
            tabIndex={-1}
            className="yr-focus-ring -mx-1 rounded-control px-1 text-base font-semibold text-ink"
          >
            Research filters
          </h2>
          {activeCount > 0 && (
            <>
              <span className="min-w-5 rounded-full bg-[var(--yr-blue)] px-1.5 py-0.5 text-center text-xs font-semibold text-white">
                {activeCount}
              </span>
              <button
                type="button"
                onClick={() => {
                  onClearAll();
                  focusResearchFiltersEntry();
                }}
                className="yr-focus-ring -my-2.5 ml-auto inline-flex min-h-11 shrink-0 items-center rounded-control px-2 text-sm font-semibold text-muted hover:text-ink"
              >
                Clear all filters
              </button>
            </>
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
        </div>
      </section>
    );
  }

  return (
    <div
      className={`flex min-w-0 max-w-full items-center gap-2 ${trailingControl ? 'mt-1' : 'mt-3'}`}
    >
      <div className="relative min-w-0 max-w-full shrink-0">
        <button
          ref={triggerRef}
          data-research-filters-entry=""
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
      {trailingControl && <div className="ml-auto shrink-0">{trailingControl}</div>}
    </div>
  );
};

export default ResearchFilterDisclosure;
