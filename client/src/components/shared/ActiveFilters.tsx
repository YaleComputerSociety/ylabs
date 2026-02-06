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
  // Quick filter row
  quickFilters?: QuickFilterDef[];
  activeQuickFilter?: string | null;
  onQuickFilterChange?: (value: string | null) => void;
  // Result count
  totalCount?: number;
  isLoading?: boolean;
  // Active filter chips
  chips: ActiveFilterChip[];
  onClearAll: () => void;
  // Height reporting for layout
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
    <div ref={barRef} className="bg-white border-b border-gray-100">
      <div className="mx-auto max-w-[1300px] px-6">
        {/* Quick filters + result count */}
        <div className="flex items-center justify-between py-2 gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            {hasQuickFilters && onQuickFilterChange && quickFilters!.map((option) => {
              const isActive = activeQuickFilter === option.value;
              return (
                <button
                  key={option.value}
                  onClick={() => onQuickFilterChange(isActive ? null : option.value)}
                  className={`
                    inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full
                    transition-all duration-200 border cursor-pointer
                    ${isActive
                      ? 'bg-blue-50 text-blue-700 border-blue-200'
                      : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300 hover:text-gray-700'
                    }
                  `}
                >
                  {option.icon}
                  {option.label}
                  {isActive && (
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
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

        {/* Active filter chips + clear all */}
        {hasChips && (
          <div className="flex flex-wrap items-center gap-2 pb-2 pt-1.5 border-t border-gray-100">
            {chips.map((chip) => (
              <span
                key={chip.key}
                className={`${chip.colorClass} px-2 py-0.5 rounded text-xs flex items-center`}
              >
                <span className="whitespace-nowrap">{chip.label}</span>
                <button
                  type="button"
                  onClick={chip.onRemove}
                  className="ml-1.5 text-gray-500 hover:text-gray-700"
                >
                  x
                </button>
              </span>
            ))}
            {hasAnyFilter && (
              <button
                onClick={onClearAll}
                className="text-gray-400 hover:text-gray-600 text-xs transition-colors flex items-center gap-1"
              >
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
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
