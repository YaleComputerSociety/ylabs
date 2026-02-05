import { useContext, useState, useRef, useEffect } from 'react';
import FellowshipSearchContext from '../../contexts/FellowshipSearchContext';

type FilterTab = 'year' | 'term' | 'purpose' | 'region' | 'citizenship';

const NavbarFellowshipCombinedFilter = () => {
  const {
    filterOptions,
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
  } = useContext(FellowshipSearchContext);

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<FilterTab>('year');

  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const totalFilters =
    selectedYearOfStudy.length +
    selectedTermOfAward.length +
    selectedPurpose.length +
    selectedRegions.length +
    selectedCitizenship.length;

  const tabs: { key: FilterTab; label: string; count: number }[] = [
    { key: 'year', label: 'Year', count: selectedYearOfStudy.length },
    { key: 'term', label: 'Term', count: selectedTermOfAward.length },
    { key: 'purpose', label: 'Purpose', count: selectedPurpose.length },
    { key: 'region', label: 'Region', count: selectedRegions.length },
    { key: 'citizenship', label: 'Citizenship', count: selectedCitizenship.length },
  ];

  const getTabContent = () => {
    switch (activeTab) {
      case 'year':
        return { options: filterOptions.yearOfStudy, selected: selectedYearOfStudy, setSelected: setSelectedYearOfStudy };
      case 'term':
        return { options: filterOptions.termOfAward, selected: selectedTermOfAward, setSelected: setSelectedTermOfAward };
      case 'purpose':
        return { options: filterOptions.purpose, selected: selectedPurpose, setSelected: setSelectedPurpose };
      case 'region':
        return { options: filterOptions.globalRegions, selected: selectedRegions, setSelected: setSelectedRegions };
      case 'citizenship':
        return { options: filterOptions.citizenshipStatus, selected: selectedCitizenship, setSelected: setSelectedCitizenship };
    }
  };

  const content = getTabContent();

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
        className="flex items-center h-9 px-3 border border-gray-300 rounded-md bg-white text-sm hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 whitespace-nowrap"
        style={{ color: '#374151' }}
      >
        <svg
          className="h-4 w-4 text-gray-500 mr-2"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
          />
        </svg>
        <span>Filters</span>
        {totalFilters > 0 && (
          <span className="ml-2 bg-blue-500 text-white text-xs font-medium px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
            {totalFilters}
          </span>
        )}
        <svg
          className={`ml-2 h-4 w-4 text-gray-400 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
        </svg>
      </button>

      {isDropdownOpen && (
        <div className="absolute left-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden z-50 w-[320px]">
          {/* Tab Navigation */}
          <div className="flex border-b border-gray-200 bg-gray-50">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 px-2 py-2.5 text-xs font-medium transition-colors relative ${
                  activeTab === tab.key
                    ? 'text-blue-600 bg-white border-b-2 border-blue-500 -mb-px'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                <span>{tab.label}</span>
                {tab.count > 0 && (
                  <span className={`ml-1 text-xs px-1.5 py-0.5 rounded-full ${
                    activeTab === tab.key ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-600'
                  }`}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="p-3">
            <ul className="space-y-1 max-h-[240px] overflow-y-auto">
              {content.options.map((option) => {
                const isSelected = content.selected.includes(option);
                return (
                  <li
                    key={option}
                    onClick={() => {
                      if (isSelected) {
                        content.setSelected((prev) => prev.filter((v) => v !== option));
                      } else {
                        content.setSelected((prev) => [...prev, option]);
                      }
                    }}
                    className={`px-3 py-2 cursor-pointer text-sm rounded-md flex items-center gap-3 transition-colors ${
                      isSelected ? 'bg-blue-50 text-blue-900' : 'hover:bg-gray-50 text-gray-700'
                    }`}
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                      isSelected ? 'bg-blue-500 border-blue-500' : 'border-gray-300'
                    }`}>
                      {isSelected && (
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    <span>{option}</span>
                  </li>
                );
              })}
              {content.options.length === 0 && (
                <li className="px-3 py-2 text-sm text-gray-500">No options available</li>
              )}
            </ul>
          </div>

          {/* Footer */}
          {totalFilters > 0 && (
            <div className="border-t border-gray-200 px-3 py-2 bg-gray-50">
              <button
                onClick={() => {
                  setSelectedYearOfStudy([]);
                  setSelectedTermOfAward([]);
                  setSelectedPurpose([]);
                  setSelectedRegions([]);
                  setSelectedCitizenship([]);
                }}
                className="w-full text-sm text-gray-600 hover:text-gray-900 py-1.5 rounded-md hover:bg-gray-100 transition-colors"
                onMouseDown={(e) => e.preventDefault()}
              >
                Clear all filters ({totalFilters})
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NavbarFellowshipCombinedFilter;
