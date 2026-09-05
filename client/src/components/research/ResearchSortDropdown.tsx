import { useRef, useState } from 'react';

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
      <div className="flex min-h-[44px] items-center overflow-hidden rounded-md border border-[var(--yr-line-strong)] bg-[var(--yr-panel)] text-sm">
        <button
          ref={buttonRef}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={isDropdownOpen}
          aria-label={`Sort research homes, currently ${currentLabel}`}
          onClick={() => setIsDropdownOpen((open) => !open)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            setTimeout(() => {
              if (!outerRef.current?.contains(document.activeElement)) {
                setIsDropdownOpen(false);
              }
            }, 100);
          }}
          className="flex min-h-[44px] min-w-[150px] items-center justify-between whitespace-nowrap px-3 text-slate-700 yr-focus-ring-inset"
        >
          <span className="mr-1 text-slate-500">Sort:</span>
          <span className="truncate">{currentLabel}</span>
          <svg
            aria-hidden="true"
            className={`ml-2 h-4 w-4 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`}
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
          </svg>
        </button>

        {sortBy !== 'relevance' && (
          <>
            <div className="h-5 w-px bg-slate-300" />
            <button
              type="button"
              onClick={onToggleSortDirection}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center text-slate-500 transition-colors hover:bg-[var(--yr-panel-muted)] hover:text-slate-700 yr-focus-ring-inset"
              aria-label={
                sortOrder === 'asc'
                  ? 'Sorted ascending, switch to descending'
                  : 'Sorted descending, switch to ascending'
              }
              title={sortOrder === 'asc' ? 'Ascending' : 'Descending'}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
                className={`transition-transform duration-200 ${
                  sortOrder === 'asc' ? 'rotate-0' : 'rotate-180'
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
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[180px] overflow-hidden rounded-lg border border-[var(--yr-line-strong)] bg-[var(--yr-panel)] shadow-lg">
          <ul
            role="listbox"
            aria-label="Sort research homes"
            className="max-h-[250px] overflow-y-auto"
          >
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
                {sortBy === option.value && (
                  <svg
                    aria-hidden="true"
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

export default ResearchSortDropdown;
