import { useContext, useState, useRef, useEffect, KeyboardEvent } from 'react';
import SearchContext from '../../contexts/SearchContext';
import VennDiagramToggle from './VennDiagramToggle';

const NavbarDepartmentFilter = () => {
  const {
    selectedDepartments,
    setSelectedDepartments,
    allDepartments,
    departmentsFilterMode,
    setDepartmentsFilterMode
  } = useContext(SearchContext);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
        setSearchTerm('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const filteredDepartments = allDepartments.filter(
    (department) =>
      department.toLowerCase().includes(searchTerm.toLowerCase()) &&
      !selectedDepartments.includes(department)
  );

  const handleDepartmentSelect = (department: string) => {
    if (!selectedDepartments.includes(department)) {
      setSelectedDepartments((prev) => [...prev, department]);
    } else {
      setSelectedDepartments((prev) => prev.filter((d) => d !== department));
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex((prev) =>
          prev < filteredDepartments.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex((prev) => (prev > 0 ? prev - 1 : 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < filteredDepartments.length) {
          handleDepartmentSelect(filteredDepartments[focusedIndex]);
          setSearchTerm('');
          setFocusedIndex(-1);
        } else {
          setIsDropdownOpen(false);
          setSearchTerm('');
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsDropdownOpen(false);
        setSearchTerm('');
        break;
    }
  };

  const toggleDropdown = () => {
    setIsDropdownOpen(!isDropdownOpen);
    setSearchTerm('');
    setFocusedIndex(-1);
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
            d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
          />
        </svg>
        <span>Departments</span>
        {selectedDepartments.length > 0 && (
          <span className="ml-2 bg-blue-500 text-white text-xs font-medium px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
            {selectedDepartments.length}
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
          {selectedDepartments.length >= 2 && (
            <div className="px-3 py-2 border-b border-gray-200 bg-gray-50">
              <VennDiagramToggle
                mode={departmentsFilterMode}
                setMode={setDepartmentsFilterMode}
              />
            </div>
          )}
          <div className="p-2 border-b">
            <input
              ref={inputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search departments..."
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
          </div>

          <ul className="max-h-[250px] overflow-y-auto">
            {filteredDepartments.length > 0 ? (
              filteredDepartments.map((department, index) => (
                <li
                  key={department}
                  onClick={() => {
                    handleDepartmentSelect(department);
                    setSearchTerm('');
                  }}
                  className={`px-3 py-2 cursor-pointer text-sm ${
                    focusedIndex === index
                      ? 'bg-blue-100'
                      : 'hover:bg-gray-100'
                  }`}
                  onMouseDown={(e) => e.preventDefault()}
                >
                  {department}
                </li>
              ))
            ) : (
              <li className="px-3 py-2 text-sm text-gray-500">No departments found</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
};

export default NavbarDepartmentFilter;
