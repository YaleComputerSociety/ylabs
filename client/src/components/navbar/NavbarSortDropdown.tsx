/**
 * Sort dropdown for listings browse page.
 */
import { useContext, useRef, useState } from 'react';
import SearchContext from '../../contexts/SearchContext';

const NavbarSortDropdown = () => {
  const { sortBy, setSortBy, sortDirection, onToggleSortDirection } = useContext(SearchContext);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const outerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const sortOptions = [
    { value: 'default', label: 'Best Match' },
    { value: 'createdAt', label: 'Date Added' },
    { value: 'ownerLastName', label: 'Last Name' },
    { value: 'ownerFirstName', label: 'First Name' },
    { value: 'title', label: 'Lab Title' }
  ];

  const handleSelect = (value: string) => {
    setSortBy(value);
    setIsDropdownOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!isDropdownOpen) {
          setIsDropdownOpen(true);
        } else {
          setFocusedIndex((prev) =>
            prev < sortOptions.length - 1 ? prev + 1 : prev
          );
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex((prev) => (prev > 0 ? prev - 1 : 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < sortOptions.length) {
          handleSelect(sortOptions[focusedIndex].value);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsDropdownOpen(false);
        buttonRef.current?.blur();
        break;
    }
  };

  const currentLabel = sortOptions.find((opt) => opt.value === sortBy)?.label || 'Sort';

  return (
    <div className="relative" ref={outerRef}>
      <div className="flex items-center h-9 border border-gray-300 rounded-md bg-white text-sm overflow-hidden">
        <button
          ref={buttonRef}
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            setTimeout(() => {
              if (!outerRef.current?.contains(document.activeElement)) {
                setIsDropdownOpen(false);
              }
            }, 100);
          }}
          className="flex items-center justify-between h-full px-3 min-w-[150px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset whitespace-nowrap"
          style={{ color: '#374151' }}
        >
          <span className="text-gray-500 mr-1">Sort:</span>
          <span className="truncate">{currentLabel}</span>
          <svg
            className={`ml-2 h-4 w-4 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`}
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
          </svg>
        </button>

        {sortBy !== 'default' && (
          <>
            <div className="w-px h-5 bg-gray-300" />
            <button
              onClick={onToggleSortDirection}
              className="flex items-center justify-center h-full w-8 text-gray-500 hover:text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset transition-colors"
              aria-label={sortDirection === 'asc' ? 'Sort ascending' : 'Sort descending'}
              title={sortDirection === 'asc' ? 'Ascending' : 'Descending'}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className={`transition-transform duration-200 ${
                  sortDirection === 'asc' ? 'rotate-0' : 'rotate-180'
                }`}
              >
                <path
                  d="M12 5l7 7-1.41 1.41L13 8.83V19h-2V8.83L6.41 13.41 5 12l7-7z"
                  fill="currentColor"
                />
              </svg>
            </button>
          </>
        )}
      </div>

      {isDropdownOpen && (
        <div className="absolute left-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-300 overflow-hidden z-50 min-w-[160px]">
          <ul className="max-h-[250px] overflow-y-auto">
            {sortOptions.map((option, index) => (
              <li
                key={option.value}
                onClick={() => handleSelect(option.value)}
                className={`px-3 py-2 cursor-pointer text-sm flex items-center justify-between ${
                  focusedIndex === index ? 'bg-blue-100' : 'hover:bg-gray-100'
                }`}
                onMouseDown={(e) => e.preventDefault()}
              >
                <span>{option.label}</span>
                {sortBy === option.value && (
                  <svg
                    className="h-4 w-4 text-blue-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default NavbarSortDropdown;
