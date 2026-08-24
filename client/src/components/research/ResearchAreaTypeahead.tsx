import { useEffect, useId, useMemo, useRef, useState } from 'react';

export interface ResearchAreaTypeaheadOption {
  value: string;
  count?: number;
}

interface ResearchAreaTypeaheadProps {
  options: ResearchAreaTypeaheadOption[];
  hasSelections: boolean;
  onSelect: (value: string) => void;
}

const ResearchAreaTypeahead = ({ options, hasSelections, onSelect }: ResearchAreaTypeaheadProps) => {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listboxId = useId();

  const filteredOptions = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return options;
    return options.filter((option) => option.value.toLowerCase().includes(trimmed));
  }, [options, query]);

  useEffect(() => {
    setActiveIndex(filteredOptions.length > 0 ? 0 : -1);
  }, [filteredOptions]);

  const closeDropdown = () => setIsOpen(false);

  const selectOption = (value: string) => {
    onSelect(value);
    setQuery('');
    closeDropdown();
    inputRef.current?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      setActiveIndex((prev) => (prev < filteredOptions.length - 1 ? prev + 1 : prev));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((prev) => (prev > 0 ? prev - 1 : 0));
    } else if (event.key === 'Enter') {
      if (!isOpen || activeIndex < 0) return;
      event.preventDefault();
      const option = filteredOptions[activeIndex];
      if (option) selectOption(option.value);
    } else if (event.key === 'Escape') {
      if (!isOpen) return;
      event.preventDefault();
      closeDropdown();
    }
  };

  const activeOptionId = isOpen && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined;

  return (
    <div ref={containerRef} className="min-w-0">
      <label className="block min-w-0 text-sm font-medium text-slate-800">
        Research area
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeOptionId}
          aria-label="Filter by research area"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onBlur={() => {
            window.setTimeout(() => {
              if (!containerRef.current?.contains(document.activeElement)) {
                closeDropdown();
              }
            }, 0);
          }}
          onKeyDown={handleKeyDown}
          placeholder={hasSelections ? 'Add another research area' : 'Search research areas'}
          autoComplete="off"
          className="yr-focus-ring mt-1 min-h-11 w-full min-w-0 rounded-md border border-[var(--yr-line-strong)] bg-white px-3 text-base text-slate-900"
        />
      </label>

      {isOpen && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Research area options"
          className="mt-1 max-h-56 min-w-0 overflow-y-auto rounded-md border border-[var(--yr-line-strong)] bg-white shadow-sm"
        >
          {filteredOptions.length === 0 && (
            <li className="px-3 py-2 text-sm text-slate-600">No matching research areas</li>
          )}
          {filteredOptions.map((option, index) => (
            <li
              key={option.value}
              id={`${listboxId}-option-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectOption(option.value)}
              className={`cursor-pointer truncate px-3 py-2 text-sm ${
                index === activeIndex ? 'bg-[var(--yr-blue-soft)]' : 'hover:bg-[var(--yr-panel-muted)]'
              }`}
            >
              {option.value}
              {option.count !== undefined ? ` (${option.count})` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default ResearchAreaTypeahead;
