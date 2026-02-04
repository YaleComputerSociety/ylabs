import { useContext, useRef, useEffect } from 'react';
import SearchContext from '../../contexts/SearchContext';
import { useConfig } from '../../hooks/useConfig';
import { getColorForResearchArea } from '../../utils/researchAreas';

const ActiveFiltersBar = () => {
  const {
    selectedDepartments,
    setSelectedDepartments,
    selectedResearchAreas,
    setSelectedResearchAreas,
    selectedListingResearchAreas,
    setSelectedListingResearchAreas,
    setFilterBarHeight
  } = useContext(SearchContext);

  const { getDepartmentColor: getColorFromConfig } = useConfig();

  const barRef = useRef<HTMLDivElement>(null);

  const hasFilters = selectedDepartments.length > 0 || selectedResearchAreas.length > 0 || selectedListingResearchAreas.length > 0;

  // Measure and report filter bar height
  useEffect(() => {
    if (!hasFilters) {
      setFilterBarHeight(0);
      return;
    }

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
  }, [hasFilters, setFilterBarHeight, selectedDepartments, selectedResearchAreas, selectedListingResearchAreas]);

  if (!hasFilters) {
    return null;
  }

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

  const handleRemoveAll = () => {
    setSelectedDepartments([]);
    setSelectedResearchAreas([]);
    setSelectedListingResearchAreas([]);
  };

  const getResearchAreaColor = (area: string) => {
    // Colors aligned with research field colors in researchAreas.ts
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

  const totalFilters = selectedDepartments.length + selectedResearchAreas.length + selectedListingResearchAreas.length;

  return (
    <div ref={barRef} className="fixed top-[64px] left-0 right-0 bg-white border-b border-gray-200 shadow-sm z-[1099] px-4 py-2">
      <div className="mx-auto max-w-[1300px] flex flex-wrap items-center gap-2">
        <span className="text-sm text-gray-600 font-medium">Filters:</span>
        {selectedResearchAreas.map((area) => (
          <span
            key={`area-${area}`}
            className={`${getResearchAreaColor(area)} px-2 py-1 rounded text-sm flex items-center border border-gray-300`}
          >
            <span className="whitespace-nowrap">{area}</span>
            <button
              type="button"
              onClick={() => handleRemoveResearchArea(area)}
              className="ml-2 text-gray-500 hover:text-gray-700"
            >
              x
            </button>
          </span>
        ))}
        {selectedDepartments.map((department) => (
          <span
            key={`dept-${department}`}
            className={`${getDepartmentColor(department)} px-2 py-1 rounded text-sm flex items-center`}
          >
            <span className="whitespace-nowrap">{department}</span>
            <button
              type="button"
              onClick={() => handleRemoveDepartment(department)}
              className="ml-2 text-gray-500 hover:text-gray-700"
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
              className={`${colors.bg} ${colors.text} px-2 py-1 rounded text-sm flex items-center`}
            >
              <span className="whitespace-nowrap">{area}</span>
              <button
                type="button"
                onClick={() => handleRemoveListingResearchArea(area)}
                className="ml-2 text-gray-500 hover:text-gray-700"
              >
                x
              </button>
            </span>
          );
        })}
        {totalFilters >= 2 && (
          <button
            onClick={handleRemoveAll}
            className="text-gray-500 hover:text-gray-700 text-sm transition-colors flex items-center gap-1"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
            Clear all
          </button>
        )}
      </div>
    </div>
  );
};

export default ActiveFiltersBar;
