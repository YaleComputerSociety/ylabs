import { useContext, useRef, useEffect } from 'react';
import FellowshipSearchContext from '../../contexts/FellowshipSearchContext';

const ActiveFellowshipFiltersBar = () => {
  const {
    queryString,
    setQueryString,
    selectedYearOfStudy,
    setSelectedYearOfStudy,
    selectedTermOfAward,
    setSelectedTermOfAward,
    selectedPurpose,
    setSelectedPurpose,
    selectedRegions,
    setSelectedRegions,
    selectedCitizenship,
    setSelectedCitizenship,
    setFilterBarHeight,
  } = useContext(FellowshipSearchContext);

  const barRef = useRef<HTMLDivElement>(null);

  const hasFilters =
    selectedYearOfStudy.length > 0 ||
    selectedTermOfAward.length > 0 ||
    selectedPurpose.length > 0 ||
    selectedRegions.length > 0 ||
    selectedCitizenship.length > 0 ||
    queryString.trim() !== '';

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
  }, [hasFilters, setFilterBarHeight, selectedYearOfStudy, selectedTermOfAward, selectedPurpose, selectedRegions, selectedCitizenship, queryString]);

  if (!hasFilters) {
    return null;
  }

  const handleRemoveAll = () => {
    setSelectedYearOfStudy([]);
    setSelectedTermOfAward([]);
    setSelectedPurpose([]);
    setSelectedRegions([]);
    setSelectedCitizenship([]);
    setQueryString('');
  };

  // Group filters by category
  const filterGroups = [
    { label: 'Year', values: selectedYearOfStudy, clear: () => setSelectedYearOfStudy([]) },
    { label: 'Term', values: selectedTermOfAward, clear: () => setSelectedTermOfAward([]) },
    { label: 'Purpose', values: selectedPurpose, clear: () => setSelectedPurpose([]) },
    { label: 'Region', values: selectedRegions, clear: () => setSelectedRegions([]) },
    { label: 'Citizenship', values: selectedCitizenship, clear: () => setSelectedCitizenship([]) },
  ].filter((group) => group.values.length > 0);

  // Format values: show first 3, then "+N more" if there are more
  const formatValues = (values: string[]) => {
    if (values.length <= 3) {
      return values.join(', ');
    }
    return `${values.slice(0, 2).join(', ')} +${values.length - 2} more`;
  };

  const totalFilters = filterGroups.length + (queryString.trim() !== '' ? 1 : 0);

  return (
    <div ref={barRef} className="bg-white border-b border-gray-200 shadow-sm px-4 py-2">
      <div className="mx-auto max-w-[1300px] flex flex-wrap items-center gap-2">
        <span className="text-sm text-gray-600 font-medium">Filters:</span>

        {queryString.trim() !== '' && (
          <span className="bg-gray-100 text-gray-700 px-2 py-1 rounded text-sm flex items-center border border-gray-300">
            <span className="whitespace-nowrap">"{queryString.trim()}"</span>
            <button
              type="button"
              onClick={() => setQueryString('')}
              className="ml-2 text-gray-500 hover:text-gray-700"
            >
              x
            </button>
          </span>
        )}

        {filterGroups.map((group) => (
          <span
            key={group.label}
            className="bg-gray-100 text-gray-700 px-2 py-1 rounded text-sm flex items-center border border-gray-300"
          >
            <span className="font-medium">{group.label}:</span>
            <span className="ml-1 whitespace-nowrap">{formatValues(group.values)}</span>
            <button
              type="button"
              onClick={group.clear}
              className="ml-2 text-gray-500 hover:text-gray-700"
            >
              x
            </button>
          </span>
        ))}

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

export default ActiveFellowshipFiltersBar;
