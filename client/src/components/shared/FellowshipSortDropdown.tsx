/**
 * Sort dropdown for fellowship browse controls.
 */
import { useContext, useRef, useState } from 'react';
import FellowshipSearchContext from '../../contexts/FellowshipSearchContext';
import { ArrowUpIcon, CheckIcon, ChevronDownIcon } from './icons';

const sortOptions = [
  { value: 'default', label: 'Recommended' },
  { value: 'deadline', label: 'Deadline' },
  { value: 'title', label: 'Name' },
];

const FellowshipSortDropdown = () => {
  const { sortBy, setSortBy, sortDirection, onToggleSortDirection } =
    useContext(FellowshipSearchContext);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const outerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

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
          setFocusedIndex((prev) => (prev < sortOptions.length - 1 ? prev + 1 : prev));
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
      <div className="flex min-h-[44px] items-center overflow-hidden rounded-card border border-[var(--yr-line-strong)] bg-[var(--yr-panel)] text-sm">
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
          className="flex min-h-[44px] min-w-[150px] items-center justify-between px-3 yr-focus-ring-inset whitespace-nowrap"
          style={{ color: 'var(--yr-ink-soft)' }}
        >
          <span className="text-muted mr-1">Sort:</span>
          <span className="truncate">{currentLabel}</span>
          <ChevronDownIcon
            className={`ml-2 h-4 w-4 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {sortBy !== 'default' && (
          <>
            <div className="w-px h-5 bg-line-strong" />
            <button
              onClick={onToggleSortDirection}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center text-muted transition-colors hover:bg-[var(--yr-panel-muted)] hover:text-ink-soft yr-focus-ring-inset"
              aria-label={sortDirection === 'asc' ? 'Sort ascending' : 'Sort descending'}
              title={sortDirection === 'asc' ? 'Ascending' : 'Descending'}
            >
              <ArrowUpIcon
                className={`transition-transform duration-200 ${
                  sortDirection === 'asc' ? 'rotate-0' : 'rotate-180'
                }`}
                size={14}
              />
            </button>
          </>
        )}
      </div>

      {isDropdownOpen && (
        <div className="absolute left-0 top-full mt-1 bg-[var(--yr-panel)] rounded-overlay shadow-yr-overlay border border-[var(--yr-line-strong)] overflow-hidden z-50 min-w-[180px]">
          <ul className="max-h-[250px] overflow-y-auto">
            {sortOptions.map((option, index) => (
              <li
                key={option.value}
                onClick={() => handleSelect(option.value)}
                className={`px-3 py-2 cursor-pointer text-sm flex items-center justify-between ${
                  focusedIndex === index
                    ? 'bg-[var(--yr-blue-soft)]'
                    : 'hover:bg-[var(--yr-panel-muted)]'
                }`}
                onMouseDown={(e) => e.preventDefault()}
              >
                <span>{option.label}</span>
                {sortBy === option.value && <CheckIcon className="h-4 w-4 text-brand" />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default FellowshipSortDropdown;
