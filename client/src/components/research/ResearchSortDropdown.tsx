import { useRef, useState } from 'react';
import { ArrowUpIcon, CheckIcon, ChevronDownIcon } from '../shared/icons';

export type ResearchSortField = 'relevance' | 'name' | 'lastObservedAt';

interface SortOption {
  value: ResearchSortField;
  label: string;
}

const sortOptions: SortOption[] = [
  { value: 'relevance', label: 'Recommended' },
  { value: 'name', label: 'Name' },
  { value: 'lastObservedAt', label: 'Recently updated' },
];

interface ResearchSortDropdownProps {
  sortBy: ResearchSortField;
  sortOrder: 'asc' | 'desc';
  onSortByChange: (value: ResearchSortField) => void;
  onToggleSortDirection: () => void;
}

const ResearchSortDropdown = ({
  sortBy,
  sortOrder,
  onSortByChange,
  onToggleSortDirection,
}: ResearchSortDropdownProps) => {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const outerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleSelect = (value: ResearchSortField) => {
    onSortByChange(value);
    setIsDropdownOpen(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!isDropdownOpen) {
          setIsDropdownOpen(true);
        } else {
          setFocusedIndex((prev) => (prev < sortOptions.length - 1 ? prev + 1 : prev));
        }
        break;
      case 'ArrowUp':
        event.preventDefault();
        setFocusedIndex((prev) => (prev > 0 ? prev - 1 : 0));
        break;
      case 'Enter':
        event.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < sortOptions.length) {
          handleSelect(sortOptions[focusedIndex].value);
        }
        break;
      case 'Escape':
        event.preventDefault();
        setIsDropdownOpen(false);
        buttonRef.current?.blur();
        break;
    }
  };

  const currentLabel =
    sortOptions.find((option) => option.value === sortBy)?.label || 'Recommended';

  return (
    <div className="relative" ref={outerRef}>
      <div className="flex min-h-[44px] items-center overflow-hidden rounded-card border border-[var(--yr-line-strong)] bg-[var(--yr-panel)] text-sm">
        <button
          ref={buttonRef}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={isDropdownOpen}
          aria-label={`Sort research, currently ${currentLabel}`}
          onClick={() => setIsDropdownOpen((open) => !open)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            setTimeout(() => {
              if (!outerRef.current?.contains(document.activeElement)) {
                setIsDropdownOpen(false);
              }
            }, 100);
          }}
          className="flex min-h-[44px] min-w-[150px] items-center justify-between whitespace-nowrap px-3 text-ink-soft yr-focus-ring-inset"
        >
          <span className="mr-1 text-muted">Sort:</span>
          <span className="truncate">{currentLabel}</span>
          <ChevronDownIcon
            className={`ml-2 h-4 w-4 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {sortBy !== 'relevance' && (
          <>
            <div className="h-5 w-px bg-line-strong" />
            <button
              type="button"
              onClick={onToggleSortDirection}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center text-muted transition-colors hover:bg-[var(--yr-panel-muted)] hover:text-ink-soft yr-focus-ring-inset"
              aria-label={
                sortOrder === 'asc'
                  ? 'Sorted ascending, switch to descending'
                  : 'Sorted descending, switch to ascending'
              }
              title={sortOrder === 'asc' ? 'Ascending' : 'Descending'}
            >
              <ArrowUpIcon
                className={`transition-transform duration-200 ${
                  sortOrder === 'asc' ? 'rotate-0' : 'rotate-180'
                }`}
                size={14}
              />
            </button>
          </>
        )}
      </div>

      {isDropdownOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[180px] overflow-hidden rounded-overlay border border-[var(--yr-line-strong)] bg-[var(--yr-panel)] shadow-yr-overlay">
          <ul role="listbox" aria-label="Sort research" className="max-h-[250px] overflow-y-auto">
            {sortOptions.map((option, index) => (
              <li
                key={option.value}
                role="option"
                aria-selected={sortBy === option.value}
                onClick={() => handleSelect(option.value)}
                onMouseDown={(event) => event.preventDefault()}
                className={`flex cursor-pointer items-center justify-between px-3 py-2 text-sm ${
                  focusedIndex === index
                    ? 'bg-[var(--yr-blue-soft)]'
                    : 'hover:bg-[var(--yr-panel-muted)]'
                }`}
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

export default ResearchSortDropdown;
