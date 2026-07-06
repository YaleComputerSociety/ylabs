/**
 * Active filter chips display with remove functionality.
 */
import React, { useRef, useEffect } from 'react';

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

  return (
    <div ref={barRef} className="border-b border-[var(--yr-line)] bg-[var(--yr-panel)]">
      <div className="mx-auto max-w-[1300px] px-6">
        <div className="flex items-center justify-between py-2 gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            {hasQuickFilters &&
              onQuickFilterChange &&
              quickFilters!.map((option) => {
                const isActive = activeQuickFilter === option.value;
                return (
                  <button
                    key={option.value}
                    onClick={() => onQuickFilterChange(isActive ? null : option.value)}
                    className={`
                    inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium
                    transition-all duration-200 border cursor-pointer
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200
                    ${
                      isActive
                        ? 'border-blue-200 bg-[var(--yr-blue-soft)] text-blue-700'
                        : 'border-[var(--yr-line)] bg-[var(--yr-panel)] text-gray-500 hover:border-[var(--yr-line-strong)] hover:text-gray-700'
                    }
                  `}
                  >
                    {option.icon}
                    {option.label}
                    {isActive && (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    )}
                  </button>
                );
              })}
          </div>
          {totalCount !== undefined && (
            <div className="flex items-center gap-2 flex-shrink-0">
              {isLoading && (
                <div className="w-3 h-3 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
              )}
              <span className="text-xs text-gray-400 whitespace-nowrap">
                {totalCount} {totalCount === 1 ? 'result' : 'results'}
              </span>
            </div>
          )}
        </div>

        {hasChips && (
          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--yr-line)] pb-2 pt-1.5">
            {chips.map((chip) => (
              <span
                key={chip.key}
                className={`${chip.colorClass} px-2 py-0.5 rounded text-xs flex items-center`}
              >
                <span className="whitespace-nowrap">{chip.label}</span>
                <button
                  type="button"
                  onClick={chip.onRemove}
                  className="ml-1.5 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-gray-500 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                >
                  x
                </button>
              </span>
            ))}
            {hasAnyFilter && (
              <button
                onClick={onClearAll}
                className="inline-flex min-h-[44px] items-center gap-1 rounded-md px-2 text-xs text-gray-400 transition-colors hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
              >
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
                Clear all
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ActiveFilters;
