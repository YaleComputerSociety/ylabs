/**
 * Multi-category filter dropdown for browse pages.
 */
import { useState, useRef, useEffect } from 'react';
import { FilterMode } from '../../contexts/SearchContext';
import VennDiagramToggle from '../navbar/VennDiagramToggle';

export interface FilterTabConfig {
  key: string;
  label: string;
  options: string[];
  selected: string[];
  setSelected: React.Dispatch<React.SetStateAction<string[]>>;
  searchable?: boolean;
  colorFn?: (item: string) => { bg: string; text: string };
  maxDisplay?: number;
  filterMode?: FilterMode;
  setFilterMode?: React.Dispatch<React.SetStateAction<FilterMode>>;
}

interface CombinedFilterDropdownProps {
  tabs: FilterTabConfig[];
  mobileSheet?: boolean;
  dialogLabel?: string;
}

const CombinedFilterDropdown = ({
  tabs,
  mobileSheet = false,
  dialogLabel = 'Filters',
}: CombinedFilterDropdownProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTabKey, setActiveTabKey] = useState(tabs[0]?.key || '');
  const [searchTerms, setSearchTerms] = useState<Record<string, string>>({});

  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const getFocusableElements = () => {
    const desktop = window.matchMedia?.('(min-width: 640px)').matches ?? false;
    return Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) || [],
    ).filter((element) => !(desktop && element.dataset.mobileOnly === 'true'));
  };

  const closeFilters = (restoreFocus = true) => {
    setIsOpen(false);
    if (restoreFocus) window.setTimeout(() => triggerRef.current?.focus(), 0);
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setIsOpen(false);
      if (mobileSheet) window.setTimeout(() => triggerRef.current?.focus(), 0);
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, mobileSheet]);

  useEffect(() => {
    if (!isOpen || !mobileSheet) return;
    window.setTimeout(() => {
      getFocusableElements()[0]?.focus();
    }, 0);
  }, [isOpen, mobileSheet]);

  const totalFilters = tabs.reduce((sum, tab) => sum + tab.selected.length, 0);
  const activeTab = tabs.find((t) => t.key === activeTabKey) || tabs[0];

  const getSearch = (key: string) => searchTerms[key] || '';
  const setSearch = (key: string, val: string) =>
    setSearchTerms((prev) => ({ ...prev, [key]: val }));

  const getFilteredOptions = (tab: FilterTabConfig) => {
    const search = getSearch(tab.key).toLowerCase();
    const filtered = search
      ? tab.options.filter((o) => o.toLowerCase().includes(search))
      : tab.options;

    const sorted = [
      ...tab.selected.filter((s) => filtered.includes(s)),
      ...filtered.filter((o) => !tab.selected.includes(o)),
    ];

    return tab.maxDisplay ? sorted.slice(0, tab.maxDisplay) : sorted;
  };

  const handleClearAll = () => {
    tabs.forEach((tab) => tab.setSelected([]));
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={isOpen}
        aria-haspopup={mobileSheet ? 'dialog' : undefined}
        onClick={() => (isOpen ? closeFilters(mobileSheet) : setIsOpen(true))}
        className="flex min-h-[44px] items-center rounded-md border border-[var(--yr-line-strong)] bg-[var(--yr-panel)] px-3 text-sm transition-colors hover:bg-[var(--yr-panel-muted)] focus:outline-none focus:ring-2 focus:ring-blue-500 whitespace-nowrap"
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
        <span>Filters</span>
        {totalFilters > 0 && (
          <span className="ml-2 bg-blue-500 text-white text-xs font-medium px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
            {totalFilters}
          </span>
        )}
        <svg
          className={`ml-2 h-4 w-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
        </svg>
      </button>

      {isOpen && (
        <div
          ref={dialogRef}
          role={mobileSheet ? 'dialog' : undefined}
          aria-modal={mobileSheet ? 'true' : undefined}
          aria-label={mobileSheet ? dialogLabel : undefined}
          tabIndex={-1}
          onKeyDown={(event) => {
            if (!mobileSheet || event.key !== 'Tab') return;
            const focusable = getFocusableElements();
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }}
          className={
            mobileSheet
              ? 'fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] w-full overflow-hidden rounded-t-md border border-[var(--yr-line)] bg-[var(--yr-panel)] shadow-lg sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-1 sm:w-[340px] sm:max-w-[calc(100vw-2rem)] sm:rounded-md'
              : 'absolute left-0 top-full z-50 mt-1 w-[calc(100vw-2rem)] max-w-[340px] overflow-hidden rounded-lg border border-[var(--yr-line)] bg-[var(--yr-panel)] shadow-lg'
          }
        >
          {mobileSheet && (
            <div className="flex items-center justify-between border-b border-[var(--yr-line)] px-3 py-2 sm:hidden">
              <h2 className="text-base font-semibold text-slate-900">Filters</h2>
              <button
                type="button"
                aria-label="Close filters"
                data-mobile-only="true"
                onClick={() => closeFilters()}
                className="flex h-11 w-11 items-center justify-center rounded-md text-2xl text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
          )}
          <div className="flex border-b border-[var(--yr-line)] bg-[var(--yr-panel-muted)] overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                aria-pressed={activeTabKey === tab.key}
                onClick={() => setActiveTabKey(tab.key)}
                className={`relative flex min-h-[44px] flex-1 items-center justify-center px-2 py-2.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  activeTabKey === tab.key
                    ? 'text-blue-600 bg-[var(--yr-panel)] border-b-2 border-blue-500 -mb-px'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-[var(--yr-panel-muted)]'
                }`}
              >
                <span>{tab.label}</span>
                {tab.selected.length > 0 && (
                  <span
                    className={`ml-1 text-xs px-1.5 py-0.5 rounded-full ${
                      activeTabKey === tab.key
                        ? 'bg-[var(--yr-blue-soft)] text-blue-700'
                        : 'bg-[var(--yr-panel-muted)] text-gray-600'
                    }`}
                  >
                    {tab.selected.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div
            className={
              mobileSheet
                ? 'max-h-[calc(85dvh-7rem)] overflow-y-auto p-3 sm:max-h-none sm:overflow-visible'
                : 'p-3'
            }
          >
            {activeTab.filterMode && activeTab.setFilterMode && activeTab.selected.length >= 2 && (
              <div className="mb-3">
                <VennDiagramToggle mode={activeTab.filterMode} setMode={activeTab.setFilterMode} />
              </div>
            )}

            {activeTab.searchable && (
              <input
                type="text"
                value={getSearch(activeTab.key)}
                onChange={(e) => setSearch(activeTab.key, e.target.value)}
                placeholder={`Search ${activeTab.label.toLowerCase()}...`}
                className="w-full px-3 py-2 border border-[var(--yr-line)] rounded-md text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            )}

            {activeTab.selected.length > 0 && activeTab.searchable && (
              <button
                onClick={() => activeTab.setSelected([])}
                className="text-xs text-blue-600 hover:text-blue-800 mb-2 font-medium"
                onMouseDown={(e) => e.preventDefault()}
              >
                Clear selected ({activeTab.selected.length})
              </button>
            )}

            <fieldset className="space-y-1 max-h-[220px] overflow-y-auto">
              <legend className="sr-only">{activeTab.label} filters</legend>
              {getFilteredOptions(activeTab).map((option) => {
                const isSelected = activeTab.selected.includes(option);
                const colors = activeTab.colorFn?.(option);

                return (
                  <label
                    key={option}
                    className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset ${
                      isSelected
                        ? 'bg-[var(--yr-blue-soft)] text-blue-900'
                        : 'hover:bg-[var(--yr-panel-muted)] text-gray-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {
                        activeTab.setSelected((prev) =>
                          isSelected ? prev.filter((v) => v !== option) : [...prev, option],
                        );
                      }}
                      className="peer sr-only"
                    />
                    <span
                      className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                        isSelected
                          ? 'bg-blue-500 border-blue-500'
                          : 'border-[var(--yr-line-strong)]'
                      } peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500 peer-focus-visible:ring-offset-2`}
                      aria-hidden="true"
                    >
                      {isSelected && (
                        <svg
                          className="w-3 h-3 text-white"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="3"
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      )}
                    </span>
                    {colors ? (
                      <span
                        className={`${colors.bg} ${colors.text} text-xs rounded px-2 py-1 truncate`}
                      >
                        {option}
                      </span>
                    ) : (
                      <span className="truncate">{option}</span>
                    )}
                  </label>
                );
              })}
              {getFilteredOptions(activeTab).length === 0 && (
                <p className="px-3 py-2 text-sm text-gray-500">No options found</p>
              )}
              {activeTab.maxDisplay && activeTab.options.length > activeTab.maxDisplay && (
                <p className="px-3 py-2 text-xs text-gray-400 text-center">
                  Showing first {activeTab.maxDisplay}. Type to search more...
                </p>
              )}
            </fieldset>
          </div>

          {totalFilters > 0 && (
            <div className="border-t border-[var(--yr-line)] px-3 py-2 bg-[var(--yr-panel-muted)]">
              <button
                onClick={handleClearAll}
                className="w-full text-sm text-gray-600 hover:text-gray-900 py-1.5 rounded-md hover:bg-[var(--yr-panel-muted)] transition-colors"
                onMouseDown={(e) => e.preventDefault()}
              >
                Clear all filters ({totalFilters})
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CombinedFilterDropdown;
