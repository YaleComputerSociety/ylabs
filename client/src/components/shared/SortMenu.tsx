import { useId, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ArrowUpIcon, CheckIcon, ChevronDownIcon } from './icons';

export type SortDirection = 'asc' | 'desc';

export interface SortMenuOption<Value extends string> {
  value: Value;
  label: string;
}

interface SortMenuProps<Value extends string> {
  subject: string;
  options: readonly SortMenuOption<Value>[];
  value: Value;
  directionlessValue: Value;
  sortDirection: SortDirection;
  onChange: (value: Value) => void;
  onToggleSortDirection: () => void;
}

const clampIndex = (index: number, length: number) => Math.min(Math.max(index, 0), length - 1);

const SortMenu = <Value extends string>({
  subject,
  options,
  value,
  directionlessValue,
  sortDirection,
  onChange,
  onToggleSortDirection,
}: SortMenuProps<Value>) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useId();
  const optionId = (index: number) => `${listboxId}-option-${index}`;

  const selectedIndex = Math.max(
    options.findIndex((option) => option.value === value),
    0,
  );
  const currentLabel = options[selectedIndex]?.label ?? '';

  const open = (index = selectedIndex) => {
    setActiveIndex(clampIndex(index, options.length));
    setIsOpen(true);
  };

  const close = () => setIsOpen(false);

  const choose = (index: number) => {
    const option = options[index];
    if (option && option.value !== value) onChange(option.value);
    close();
  };

  const moveActive = (next: number) => setActiveIndex(clampIndex(next, options.length));

  const handleClosedKeyDown = (event: KeyboardEvent) => {
    switch (event.key) {
      case 'Enter':
      case ' ':
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault();
        open();
        break;
      case 'Home':
        event.preventDefault();
        open(0);
        break;
      case 'End':
        event.preventDefault();
        open(options.length - 1);
        break;
    }
  };

  const handleOpenKeyDown = (event: KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveActive(activeIndex + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveActive(activeIndex - 1);
        break;
      case 'Home':
        event.preventDefault();
        moveActive(0);
        break;
      case 'End':
        event.preventDefault();
        moveActive(options.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        choose(activeIndex);
        break;
      case 'Escape':
        event.preventDefault();
        close();
        break;
      case 'Tab':
        close();
        break;
    }
  };

  return (
    <div className="relative">
      <div className="flex min-h-[44px] items-center overflow-hidden rounded-card border border-[var(--yr-line-strong)] bg-[var(--yr-panel)] text-sm">
        <div
          role="combobox"
          tabIndex={0}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-activedescendant={isOpen ? optionId(activeIndex) : undefined}
          aria-label={`Sort ${subject}, currently ${currentLabel}`}
          onClick={() => (isOpen ? close() : open())}
          onKeyDown={isOpen ? handleOpenKeyDown : handleClosedKeyDown}
          onBlur={close}
          className="flex min-h-[44px] min-w-[150px] cursor-pointer select-none items-center justify-between whitespace-nowrap px-3 text-ink-soft yr-focus-ring-inset"
        >
          <span className="mr-1 text-muted">Sort:</span>
          <span className="truncate">{currentLabel}</span>
          <ChevronDownIcon
            className={`ml-2 h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </div>

        {value !== directionlessValue && (
          <>
            <div className="h-5 w-px bg-line-strong" />
            <button
              type="button"
              onClick={onToggleSortDirection}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center text-muted transition-colors hover:bg-[var(--yr-panel-muted)] hover:text-ink-soft yr-focus-ring-inset"
              aria-label={
                sortDirection === 'asc'
                  ? 'Sorted ascending, switch to descending'
                  : 'Sorted descending, switch to ascending'
              }
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

      <div
        hidden={!isOpen}
        className="absolute left-0 top-full z-50 mt-1 min-w-[180px] overflow-hidden rounded-overlay border border-[var(--yr-line-strong)] bg-[var(--yr-panel)] shadow-yr-overlay"
      >
        <ul
          id={listboxId}
          role="listbox"
          aria-label={`Sort ${subject}`}
          className="max-h-[250px] overflow-y-auto"
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              id={optionId(index)}
              role="option"
              aria-selected={index === selectedIndex}
              onClick={() => choose(index)}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              className={`flex min-h-[44px] cursor-pointer items-center justify-between px-3 text-sm ${
                isOpen && index === activeIndex ? 'bg-[var(--yr-blue-soft)]' : ''
              }`}
            >
              <span>{option.label}</span>
              {index === selectedIndex && <CheckIcon className="h-4 w-4 text-brand" />}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default SortMenu;
