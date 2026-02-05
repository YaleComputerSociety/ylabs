import { useContext, useState, useRef, useEffect } from 'react';
import SearchContext from '../../contexts/SearchContext';
import VennDiagramToggle from './VennDiagramToggle';
import { getColorForResearchArea } from '../../utils/researchAreas';

const getAcademicDisciplineColor = (area: string): { bg: string; text: string } => {
  switch (area) {
    case 'Computing & AI':
      return { bg: 'bg-blue-200', text: 'text-blue-800' };
    case 'Life Sciences':
      return { bg: 'bg-green-200', text: 'text-green-800' };
    case 'Physical Sciences & Engineering':
      return { bg: 'bg-yellow-200', text: 'text-yellow-800' };
    case 'Health & Medicine':
      return { bg: 'bg-red-200', text: 'text-red-800' };
    case 'Social Sciences':
      return { bg: 'bg-purple-200', text: 'text-purple-800' };
    case 'Humanities & Arts':
      return { bg: 'bg-pink-200', text: 'text-pink-800' };
    case 'Environmental Sciences':
      return { bg: 'bg-teal-200', text: 'text-teal-800' };
    case 'Economics':
      return { bg: 'bg-orange-200', text: 'text-orange-800' };
    case 'Mathematics':
      return { bg: 'bg-indigo-200', text: 'text-indigo-800' };
    default:
      return { bg: 'bg-gray-200', text: 'text-gray-800' };
  }
};

type FilterTab = 'departments' | 'disciplines' | 'researchAreas';

const NavbarCombinedFilter = () => {
  const {
    selectedDepartments,
    setSelectedDepartments,
    allDepartments,
    departmentsFilterMode,
    setDepartmentsFilterMode,
    selectedResearchAreas,
    setSelectedResearchAreas,
    allResearchAreas,
    researchAreasFilterMode,
    setResearchAreasFilterMode,
    selectedListingResearchAreas,
    setSelectedListingResearchAreas,
    allListingResearchAreas,
    listingResearchAreasFilterMode,
    setListingResearchAreasFilterMode,
  } = useContext(SearchContext);

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<FilterTab>('departments');
  const [departmentSearch, setDepartmentSearch] = useState('');
  const [researchAreaSearch, setResearchAreaSearch] = useState('');

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
    selectedDepartments.length +
    selectedResearchAreas.length +
    selectedListingResearchAreas.length;

  const filteredDepartments = allDepartments.filter(
    (dept) => dept.toLowerCase().includes(departmentSearch.toLowerCase())
  );

  const filteredResearchAreas = researchAreaSearch.trim()
    ? allListingResearchAreas.filter((area) =>
        area.toLowerCase().includes(researchAreaSearch.toLowerCase())
      )
    : allListingResearchAreas;

  const sortedResearchAreas = [
    ...selectedListingResearchAreas.filter((area) => filteredResearchAreas.includes(area)),
    ...filteredResearchAreas.filter((area) => !selectedListingResearchAreas.includes(area)),
  ];

  const tabs: { key: FilterTab; label: string; count: number }[] = [
    { key: 'departments', label: 'Departments', count: selectedDepartments.length },
    { key: 'disciplines', label: 'Disciplines', count: selectedResearchAreas.length },
    { key: 'researchAreas', label: 'Research', count: selectedListingResearchAreas.length },
  ];

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
        <div className="absolute left-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden z-50 w-[340px]">
          {/* Tab Navigation */}
          <div className="flex border-b border-gray-200 bg-gray-50">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 px-3 py-2.5 text-xs font-medium transition-colors relative ${
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
            {/* Departments Tab */}
            {activeTab === 'departments' && (
              <div>
                {selectedDepartments.length >= 2 && (
                  <div className="mb-3">
                    <VennDiagramToggle mode={departmentsFilterMode} setMode={setDepartmentsFilterMode} />
                  </div>
                )}
                <input
                  type="text"
                  value={departmentSearch}
                  onChange={(e) => setDepartmentSearch(e.target.value)}
                  placeholder="Search departments..."
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <ul className="space-y-1 max-h-[200px] overflow-y-auto">
                  {filteredDepartments.map((dept) => {
                    const isSelected = selectedDepartments.includes(dept);
                    return (
                      <li
                        key={dept}
                        onClick={() => {
                          if (isSelected) {
                            setSelectedDepartments((prev) => prev.filter((d) => d !== dept));
                          } else {
                            setSelectedDepartments((prev) => [...prev, dept]);
                          }
                        }}
                        className={`px-3 py-2 cursor-pointer text-sm rounded-md flex items-center gap-3 transition-colors ${
                          isSelected ? 'bg-blue-50 text-blue-900' : 'hover:bg-gray-50 text-gray-700'
                        }`}
                        onMouseDown={(e) => e.preventDefault()}
                      >
                        <div className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                          isSelected ? 'bg-blue-500 border-blue-500' : 'border-gray-300'
                        }`}>
                          {isSelected && (
                            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                        <span className="truncate">{dept}</span>
                      </li>
                    );
                  })}
                  {filteredDepartments.length === 0 && (
                    <li className="px-3 py-2 text-sm text-gray-500">No departments found</li>
                  )}
                </ul>
              </div>
            )}

            {/* Academic Disciplines Tab */}
            {activeTab === 'disciplines' && (
              <div>
                {selectedResearchAreas.length >= 2 && (
                  <div className="mb-3">
                    <VennDiagramToggle mode={researchAreasFilterMode} setMode={setResearchAreasFilterMode} />
                  </div>
                )}
                <ul className="space-y-1 max-h-[240px] overflow-y-auto">
                  {allResearchAreas.map((area) => {
                    const colors = getAcademicDisciplineColor(area);
                    const isSelected = selectedResearchAreas.includes(area);
                    return (
                      <li
                        key={area}
                        onClick={() => {
                          if (isSelected) {
                            setSelectedResearchAreas((prev) => prev.filter((a) => a !== area));
                          } else {
                            setSelectedResearchAreas((prev) => [...prev, area]);
                          }
                        }}
                        className={`px-3 py-2 cursor-pointer text-sm rounded-md flex items-center gap-3 transition-colors ${
                          isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                        }`}
                        onMouseDown={(e) => e.preventDefault()}
                      >
                        <div className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                          isSelected ? 'bg-blue-500 border-blue-500' : 'border-gray-300'
                        }`}>
                          {isSelected && (
                            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                        <span className={`${colors.bg} ${colors.text} text-xs rounded px-2 py-1`}>
                          {area}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Research Areas Tab */}
            {activeTab === 'researchAreas' && (
              <div>
                {selectedListingResearchAreas.length >= 2 && (
                  <div className="mb-3">
                    <VennDiagramToggle mode={listingResearchAreasFilterMode} setMode={setListingResearchAreasFilterMode} />
                  </div>
                )}
                <input
                  type="text"
                  value={researchAreaSearch}
                  onChange={(e) => setResearchAreaSearch(e.target.value)}
                  placeholder="Search research areas..."
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                {selectedListingResearchAreas.length > 0 && (
                  <button
                    onClick={() => setSelectedListingResearchAreas([])}
                    className="text-xs text-blue-600 hover:text-blue-800 mb-2 font-medium"
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    Clear selected ({selectedListingResearchAreas.length})
                  </button>
                )}
                <ul className="space-y-1 max-h-[180px] overflow-y-auto">
                  {sortedResearchAreas.slice(0, 100).map((area) => {
                    const colors = getColorForResearchArea(area);
                    const isSelected = selectedListingResearchAreas.includes(area);
                    return (
                      <li
                        key={area}
                        onClick={() => {
                          if (isSelected) {
                            setSelectedListingResearchAreas((prev) => prev.filter((a) => a !== area));
                          } else {
                            setSelectedListingResearchAreas((prev) => [...prev, area]);
                          }
                        }}
                        className={`px-3 py-2 cursor-pointer text-sm rounded-md flex items-center gap-3 transition-colors ${
                          isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                        }`}
                        onMouseDown={(e) => e.preventDefault()}
                      >
                        <div className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                          isSelected ? 'bg-blue-500 border-blue-500' : 'border-gray-300'
                        }`}>
                          {isSelected && (
                            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                        <span className={`${colors.bg} ${colors.text} text-xs rounded px-2 py-1 truncate`}>
                          {area}
                        </span>
                      </li>
                    );
                  })}
                  {sortedResearchAreas.length === 0 && (
                    <li className="px-3 py-2 text-sm text-gray-500">No research areas found</li>
                  )}
                  {sortedResearchAreas.length > 100 && (
                    <li className="px-3 py-2 text-xs text-gray-400 text-center">
                      Showing first 100. Type to search more...
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>

          {/* Footer */}
          {totalFilters > 0 && (
            <div className="border-t border-gray-200 px-3 py-2 bg-gray-50">
              <button
                onClick={() => {
                  setSelectedDepartments([]);
                  setSelectedResearchAreas([]);
                  setSelectedListingResearchAreas([]);
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

export default NavbarCombinedFilter;
