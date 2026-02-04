import { useContext, useState, useRef, useEffect } from 'react';
import SearchContext from '../../contexts/SearchContext';
import { getColorForResearchArea } from '../../utils/researchAreas';
import VennDiagramToggle from './VennDiagramToggle';

const NavbarListingResearchAreaFilter = () => {
  const {
    selectedListingResearchAreas,
    setSelectedListingResearchAreas,
    allListingResearchAreas,
    listingResearchAreasFilterMode,
    setListingResearchAreasFilterMode
  } = useContext(SearchContext);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

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

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isDropdownOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isDropdownOpen]);

  const handleResearchAreaToggle = (area: string) => {
    if (selectedListingResearchAreas.includes(area)) {
      setSelectedListingResearchAreas((prev) => prev.filter((a) => a !== area));
    } else {
      setSelectedListingResearchAreas((prev) => [...prev, area]);
    }
  };

  const toggleDropdown = () => {
    setIsDropdownOpen(!isDropdownOpen);
    if (!isDropdownOpen) {
      setSearchQuery('');
    }
  };

  // Filter research areas based on search query
  const filteredAreas = searchQuery.trim()
    ? allListingResearchAreas.filter(area =>
        area.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : allListingResearchAreas;

  // Show selected areas first, then filtered results
  const sortedAreas = [
    ...selectedListingResearchAreas.filter(area => filteredAreas.includes(area)),
    ...filteredAreas.filter(area => !selectedListingResearchAreas.includes(area))
  ];

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={toggleDropdown}
        className="flex items-center h-9 px-3 border border-gray-300 rounded-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 whitespace-nowrap"
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
            d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
          />
        </svg>
        <span>Research Areas</span>
        {selectedListingResearchAreas.length > 0 && (
          <span className="ml-2 bg-blue-500 text-white text-xs font-medium px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
            {selectedListingResearchAreas.length}
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
        <div className="absolute left-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-300 overflow-hidden z-[1300] min-w-[280px]">
          {/* Search input */}
          <div className="p-2 border-b border-gray-200">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search research areas..."
              className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              onMouseDown={(e) => e.stopPropagation()}
            />
          </div>

          {/* Venn diagram toggle and clear all when items are selected */}
          {selectedListingResearchAreas.length > 0 && (
            <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between">
              {selectedListingResearchAreas.length >= 2 ? (
                <VennDiagramToggle
                  mode={listingResearchAreasFilterMode}
                  setMode={setListingResearchAreasFilterMode}
                />
              ) : (
                <span />
              )}
              <button
                onClick={() => setSelectedListingResearchAreas([])}
                className="text-xs text-blue-600 hover:text-blue-800"
                onMouseDown={(e) => e.preventDefault()}
              >
                Clear all ({selectedListingResearchAreas.length})
              </button>
            </div>
          )}

          <ul className="max-h-[300px] overflow-y-auto py-1">
            {sortedAreas.length > 0 ? (
              sortedAreas.slice(0, 100).map((area) => {
                const colors = getColorForResearchArea(area);
                const isSelected = selectedListingResearchAreas.includes(area);
                return (
                  <li
                    key={area}
                    onClick={() => handleResearchAreaToggle(area)}
                    className="px-3 py-2 cursor-pointer text-sm hover:bg-gray-100 flex items-center gap-2"
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {}}
                      className="h-4 w-4 text-blue-500 rounded border-gray-300 focus:ring-blue-500 cursor-pointer"
                    />
                    <span
                      className={`${colors.bg} ${colors.text} text-xs rounded px-1.5 py-0.5`}
                    >
                      {area}
                    </span>
                  </li>
                );
              })
            ) : (
              <li className="px-3 py-2 text-sm text-gray-500">
                No matching research areas
              </li>
            )}
            {sortedAreas.length > 100 && (
              <li className="px-3 py-2 text-xs text-gray-400 text-center">
                Showing first 100 results. Type to search more...
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
};

export default NavbarListingResearchAreaFilter;
