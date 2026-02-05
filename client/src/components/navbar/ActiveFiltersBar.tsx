import { useContext, useRef, useEffect } from 'react';
import SearchContext from '../../contexts/SearchContext';
import { useConfig } from '../../hooks/useConfig';
import { getColorForResearchArea } from '../../utils/researchAreas';

// Quick filter option definitions for listings
const listingQuickFilters = [
  {
    label: 'Open Only',
    value: 'open',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
  },
  {
    label: 'Recently Added',
    value: 'recent',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
];

const ActiveFiltersBar = () => {
  const {
    selectedDepartments,
    setSelectedDepartments,
    selectedResearchAreas,
    setSelectedResearchAreas,
    selectedListingResearchAreas,
    setSelectedListingResearchAreas,
    setFilterBarHeight,
    quickFilter,
    setQuickFilter,
    totalCount,
    isLoading,
  } = useContext(SearchContext);

  const { getDepartmentColor: getColorFromConfig } = useConfig();

  const barRef = useRef<HTMLDivElement>(null);

  const hasAdvancedFilters = selectedDepartments.length > 0 || selectedResearchAreas.length > 0 || selectedListingResearchAreas.length > 0;
  const hasAnyFilter = hasAdvancedFilters || quickFilter !== null;

  // Measure and report filter bar height
  useEffect(() => {
    const updateHeight = () => {
      if (barRef.current) {
        setFilterBarHeight(barRef.current.offsetHeight);
      }
    };

    updateHeight();

    const resizeObserver = new ResizeObserver(updateHeight);
    if (barRef.current) {
      resizeObserver.observe(barRef.current);
    }

    return () => {
      resizeObserver.disconnect();
      setFilterBarHeight(0);
    };
  }, [setFilterBarHeight, hasAdvancedFilters, quickFilter, selectedDepartments, selectedResearchAreas, selectedListingResearchAreas]);

  const getDepartmentColor = (department: string) => {
    return `${getColorFromConfig(department)} text-gray-900`;
  };

  const handleRemoveDepartment = (department: string) => {
    setSelectedDepartments((prev) => prev.filter((d) => d !== department));
  };

  const handleRemoveResearchArea = (area: string) => {
    setSelectedResearchAreas((prev) => prev.filter((a) => a !== area));
  };

  const handleRemoveListingResearchArea = (area: string) => {
    setSelectedListingResearchAreas((prev) => prev.filter((a) => a !== area));
  };

  const handleClearAll = () => {
    setSelectedDepartments([]);
    setSelectedResearchAreas([]);
    setSelectedListingResearchAreas([]);
    setQuickFilter(null);
  };

  const getResearchAreaColor = (area: string) => {
    switch (area) {
      case 'Computing & AI':
        return 'bg-blue-200 text-gray-900';
      case 'Life Sciences':
        return 'bg-green-200 text-gray-900';
      case 'Physical Sciences & Engineering':
        return 'bg-yellow-200 text-gray-900';
      case 'Health & Medicine':
        return 'bg-red-200 text-gray-900';
      case 'Social Sciences':
        return 'bg-purple-200 text-gray-900';
      case 'Humanities & Arts':
        return 'bg-pink-200 text-gray-900';
      case 'Environmental Sciences':
        return 'bg-teal-200 text-gray-900';
      case 'Economics':
        return 'bg-orange-200 text-gray-900';
      case 'Mathematics':
        return 'bg-indigo-200 text-gray-900';
      default:
        return 'bg-gray-100 text-gray-900';
    }
  };

  return (
    <div ref={barRef} className="bg-white border-b border-gray-100">
      <div className="mx-auto max-w-[1300px] px-6">
        {/* Quick filters + result count */}
        <div className="flex items-center justify-between py-2 gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            {listingQuickFilters.map((option) => {
              const isActive = quickFilter === option.value;
              return (
                <button
                  key={option.value}
                  onClick={() => setQuickFilter(isActive ? null : option.value)}
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
          <div className="flex items-center gap-2 flex-shrink-0">
            {isLoading && (
              <div className="w-3 h-3 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
            )}
            <span className="text-xs text-gray-400 whitespace-nowrap">
              {totalCount} {totalCount === 1 ? 'result' : 'results'}
            </span>
          </div>
        </div>

        {/* Advanced filters row + unified clear all */}
        {hasAdvancedFilters && (
          <div className="flex flex-wrap items-center gap-2 pb-2 pt-1.5 border-t border-gray-100">
            {selectedResearchAreas.map((area) => (
              <span
                key={`area-${area}`}
                className={`${getResearchAreaColor(area)} px-2 py-0.5 rounded text-xs flex items-center border border-gray-300`}
              >
                <span className="whitespace-nowrap">{area}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveResearchArea(area)}
                  className="ml-1.5 text-gray-500 hover:text-gray-700"
                >
                  x
                </button>
              </span>
            ))}
            {selectedDepartments.map((department) => (
              <span
                key={`dept-${department}`}
                className={`${getDepartmentColor(department)} px-2 py-0.5 rounded text-xs flex items-center`}
              >
                <span className="whitespace-nowrap">{department}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveDepartment(department)}
                  className="ml-1.5 text-gray-500 hover:text-gray-700"
                >
                  x
                </button>
              </span>
            ))}
            {selectedListingResearchAreas.map((area) => {
              const colors = getColorForResearchArea(area);
              return (
                <span
                  key={`listing-area-${area}`}
                  className={`${colors.bg} ${colors.text} px-2 py-0.5 rounded text-xs flex items-center`}
                >
                  <span className="whitespace-nowrap">{area}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveListingResearchArea(area)}
                    className="ml-1.5 text-gray-500 hover:text-gray-700"
                  >
                    x
                  </button>
                </span>
              );
            })}
            {/* Unified clear all — clears advanced filters and quick filter */}
            {hasAnyFilter && (
              <button
                onClick={handleClearAll}
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

export default ActiveFiltersBar;
