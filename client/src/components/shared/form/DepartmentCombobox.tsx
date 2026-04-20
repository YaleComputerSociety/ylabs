/**
 * Accessible single-select department combobox with keyboard navigation.
 * Extracted from ProfileEditor so the primary-dept picker doesn't duplicate
 * DepartmentInput's internals.
 */
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';

interface DepartmentComboboxProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  required?: boolean;
  invalid?: boolean;
  placeholder?: string;
  disallow?: string[];
}

const DepartmentCombobox = ({
  label,
  value,
  onChange,
  options,
  required = false,
  invalid = false,
  placeholder = 'Select…',
  disallow = [],
}: DepartmentComboboxProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const id = useId();
  const comboboxId = `${id}-combobox`;
  const listboxId = `${id}-listbox`;

  const filtered = useMemo(() => {
    const term = (isOpen ? search : '').toLowerCase();
    return options.filter(
      (opt) => opt.toLowerCase().includes(term) && opt !== value && !disallow.includes(opt)
    );
  }, [options, search, value, disallow, isOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (opt: string) => {
    onChange(opt);
    setIsOpen(false);
    setSearch('');
    setFocusedIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex((prev) => (prev < filtered.length - 1 ? prev + 1 : prev));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex((prev) => (prev > 0 ? prev - 1 : 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < filtered.length) {
          handleSelect(filtered[focusedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        setSearch('');
        inputRef.current?.blur();
        break;
      case 'Tab':
        setIsOpen(false);
        break;
    }
  };

  return (
    <div ref={containerRef}>
      <label htmlFor={comboboxId} className="block text-xs font-medium text-gray-700 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5" aria-hidden="true">*</span>}
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          id={comboboxId}
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-required={required || undefined}
          aria-invalid={invalid || undefined}
          aria-activedescendant={focusedIndex >= 0 ? `${listboxId}-option-${focusedIndex}` : undefined}
          value={isOpen ? search : value}
          onClick={() => {
            setSearch('');
            setIsOpen(true);
          }}
          onChange={(e) => {
            setSearch(e.target.value);
            setFocusedIndex(-1);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            setSearch('');
            setIsOpen(true);
          }}
          readOnly={!isOpen}
          className={`w-full text-sm border rounded-md px-3 py-1.5 pr-8 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-500 truncate ${
            invalid ? 'border-red-400' : 'border-gray-300'
          } ${!isOpen && value ? 'text-gray-900' : 'text-gray-700'}`}
          placeholder={placeholder}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          className="absolute inset-y-0 right-0 flex items-center px-2 text-gray-500 cursor-pointer"
          onClick={() => {
            if (isOpen) setSearch('');
            setIsOpen((prev) => !prev);
            if (!isOpen) inputRef.current?.focus();
          }}
        >
          <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
          </svg>
        </button>

        {isOpen && (
          <div className="absolute w-full bg-white rounded-md z-10 shadow-lg border overflow-hidden mt-1 border-gray-300">
            {value && (
              <div className="px-3 py-2 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
                <span className="text-sm text-gray-700">{value}</span>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange('');
                    setSearch('');
                    inputRef.current?.focus();
                  }}
                  className="text-xs text-red-500 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 rounded px-1"
                >
                  Clear
                </button>
              </div>
            )}
            <ul
              id={listboxId}
              role="listbox"
              aria-label={`${label} options`}
              className="max-h-[250px] p-1 overflow-y-auto"
            >
              {filtered.length > 0 ? (
                filtered.map((opt, index) => (
                  <li
                    key={opt}
                    id={`${listboxId}-option-${index}`}
                    role="option"
                    aria-selected={focusedIndex === index}
                    onClick={() => handleSelect(opt)}
                    onMouseDown={(e) => e.preventDefault()}
                    className={`p-2 cursor-pointer text-sm ${
                      focusedIndex === index ? 'bg-blue-100' : 'hover:bg-gray-100'
                    }`}
                  >
                    {opt}
                  </li>
                ))
              ) : (
                <li className="p-2 text-gray-500 text-sm" role="option" aria-selected={false}>
                  No departments found
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

export default DepartmentCombobox;
