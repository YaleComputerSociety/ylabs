/**
 * Active filter chips display with remove functionality.
 */
import React, { useEffect, useId, useRef } from 'react';
import { CloseIcon } from './icons';

export interface QuickFilterDef {
  label: string;
  value: string;
  icon?: React.ReactNode;
}

export interface ActiveFilterChip {
  key: string;
  label: string;
  colorClass: string;
  onRemove: () => void;
}

interface ActiveFiltersProps {
  quickFilters?: QuickFilterDef[];
  activeQuickFilter?: string | null;
  onQuickFilterChange?: (value: string | null) => void;
  totalCount?: number;
  isLoading?: boolean;
  chips: ActiveFilterChip[];
  onClearAll: () => void;
  onHeightChange?: (height: number) => void;
}

const ActiveFilters = ({
  quickFilters,
  activeQuickFilter,
  onQuickFilterChange,
  totalCount,
  isLoading,
  chips,
  onClearAll,
  onHeightChange,
}: ActiveFiltersProps) => {
  const barRef = useRef<HTMLDivElement>(null);
  const quickFiltersLabelId = useId();
  const hasChips = chips.length > 0;
  const hasQuickFilters = quickFilters && quickFilters.length > 0;
  const hasAnyFilter = hasChips || (activeQuickFilter !== null && activeQuickFilter !== undefined);

  useEffect(() => {
    if (!onHeightChange) return;
    const updateHeight = () => {
      if (barRef.current) {
        onHeightChange(barRef.current.offsetHeight);
      }
    };
    updateHeight();
    const resizeObserver = new ResizeObserver(updateHeight);
    if (barRef.current) {
      resizeObserver.observe(barRef.current);
    }
    return () => {
      resizeObserver.disconnect();
      onHeightChange(0);
    };
  }, [onHeightChange, hasChips, activeQuickFilter, chips.length]);

  const showsCount = totalCount !== undefined;

  return (
    <div ref={barRef} className="yr-panel rounded-card p-3">
      {(hasQuickFilters || showsCount) && (
        <div className="flex min-h-5 items-center justify-between gap-3">
          {hasQuickFilters && (
            <p id={quickFiltersLabelId} className="text-xs font-semibold text-ink-soft">
              Quick filters
            </p>
          )}
          {showsCount && (
            <div className="ml-auto flex items-center gap-2">
              {isLoading && (
                <div className="w-3 h-3 border-2 border-line-brand border-t-brand rounded-full animate-spin" />
              )}
              <span
                className="yr-num text-xs text-muted whitespace-nowrap"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {totalCount} {totalCount === 1 ? 'result' : 'results'}
              </span>
            </div>
          )}
        </div>
      )}

      {hasQuickFilters && onQuickFilterChange && (
        <div
          role="group"
          aria-labelledby={quickFiltersLabelId}
          className="mt-2 flex flex-wrap gap-1.5"
        >
          {quickFilters!.map((option) => {
            const isActive = activeQuickFilter === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={isActive}
                onClick={() => onQuickFilterChange(isActive ? null : option.value)}
                className={`
                    yr-focus-ring inline-flex min-h-[44px] items-center gap-1.5 rounded-control px-2.5 py-2 text-xs font-medium
                    transition-colors duration-200 border cursor-pointer
                    ${
                      isActive
                        ? 'border-line-brand bg-brand-soft text-brand'
                        : 'border-line bg-panel text-muted hover:border-line-strong hover:text-ink-soft'
                    }
                  `}
              >
                {option.icon}
                {option.label}
                {isActive && <CloseIcon size={10} />}
              </button>
            );
          })}
        </div>
      )}

      {hasChips && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-line pt-2">
          {chips.map((chip) => (
            <span
              key={chip.key}
              className={`${chip.colorClass} px-2 py-0.5 rounded-control text-xs flex items-center`}
            >
              <span className="whitespace-nowrap">{chip.label}</span>
              <button
                type="button"
                onClick={chip.onRemove}
                aria-label={`Remove ${chip.label} filter`}
                className="yr-focus-ring ml-1.5 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-control text-muted hover:text-ink-soft"
              >
                <CloseIcon size={10} />
              </button>
            </span>
          ))}
          {hasAnyFilter && (
            <button
              onClick={onClearAll}
              className="yr-focus-ring inline-flex min-h-[44px] items-center gap-1 rounded-control px-2 text-xs text-muted transition-colors hover:text-ink"
            >
              <CloseIcon className="h-3 w-3" />
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default ActiveFilters;
