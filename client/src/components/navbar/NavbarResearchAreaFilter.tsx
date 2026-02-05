import { useContext, useState, useRef, useEffect } from 'react';
import SearchContext from '../../contexts/SearchContext';
import VennDiagramToggle from './VennDiagramToggle';

// Colors aligned with research field colors in researchAreas.ts
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

const NavbarResearchAreaFilter = () => {
  const {
    selectedResearchAreas,
    setSelectedResearchAreas,
    allResearchAreas,
    researchAreasFilterMode,
    setResearchAreasFilterMode
  } = useContext(SearchContext);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

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

  const handleResearchAreaToggle = (area: string) => {
    if (selectedResearchAreas.includes(area)) {
      setSelectedResearchAreas((prev) => prev.filter((a) => a !== area));
    } else {
      setSelectedResearchAreas((prev) => [...prev, area]);
    }
  };

  const toggleDropdown = () => {
    setIsDropdownOpen(!isDropdownOpen);
  };

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
            d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
          />
        </svg>
        <span>Academic Disciplines</span>
        <span className={`ml-2 text-xs font-medium px-1.5 py-0.5 rounded-full w-[20px] text-center ${selectedResearchAreas.length > 0 ? 'bg-blue-500 text-white' : 'invisible'}`}>
          {selectedResearchAreas.length || 0}
        </span>
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
        <div className="absolute left-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-300 overflow-hidden z-50 min-w-[220px]">
          {selectedResearchAreas.length >= 2 && (
            <div className="px-3 py-2 border-b border-gray-200 bg-gray-50">
              <VennDiagramToggle
                mode={researchAreasFilterMode}
                setMode={setResearchAreasFilterMode}
              />
            </div>
          )}
          <ul className="max-h-[300px] overflow-y-auto py-1">
            {allResearchAreas.map((area) => {
              const colors = getAcademicDisciplineColor(area);
              return (
                <li
                  key={area}
                  onClick={() => handleResearchAreaToggle(area)}
                  className="px-3 py-2 cursor-pointer text-sm hover:bg-gray-100 flex items-center gap-2"
                  onMouseDown={(e) => e.preventDefault()}
                >
                  <input
                    type="checkbox"
                    checked={selectedResearchAreas.includes(area)}
                    onChange={() => {}}
                    className="h-4 w-4 text-blue-500 rounded border-gray-300 focus:ring-blue-500 cursor-pointer"
                  />
                  <span className={`${colors.bg} ${colors.text} text-xs rounded px-1.5 py-0.5`}>
                    {area}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};

export default NavbarResearchAreaFilter;
