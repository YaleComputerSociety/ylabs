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
}

const CombinedFilterDropdown = ({ tabs }: CombinedFilterDropdownProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTabKey, setActiveTabKey] = useState(tabs[0]?.key || '');
  const [searchTerms, setSearchTerms] = useState<Record<string, string>>({});

  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center h-9 px-3 border border-gray-300 rounded-md bg-white text-sm hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 whitespace-nowrap"
        style={{ color: '#374151' }}
      >
        <svg className="h-4 w-4 text-gray-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
        </svg>
        <span>Filters</span>
        {totalFilters > 0 && (
          <span className="ml-2 bg-blue-500 text-white text-xs font-medium px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
            {totalFilters}
          </span>
        )}
        <svg className={`ml-2 h-4 w-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
          <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden z-50 w-[340px]">
          <div className="flex border-b border-gray-200 bg-gray-50 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTabKey(tab.key)}
                className={`flex-1 px-2 py-2.5 text-xs font-medium transition-colors relative whitespace-nowrap ${
                  activeTabKey === tab.key
                    ? 'text-blue-600 bg-white border-b-2 border-blue-500 -mb-px'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                <span>{tab.label}</span>
                {tab.selected.length > 0 && (
                  <span className={`ml-1 text-xs px-1.5 py-0.5 rounded-full ${
                    activeTabKey === tab.key ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-600'
                  }`}>
                    {tab.selected.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="p-3">
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
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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

            <ul className="space-y-1 max-h-[220px] overflow-y-auto">
              {getFilteredOptions(activeTab).map((option) => {
                const isSelected = activeTab.selected.includes(option);
                const colors = activeTab.colorFn?.(option);

                return (
                  <li
                    key={option}
                    onClick={() => {
                      if (isSelected) {
                        activeTab.setSelected((prev) => prev.filter((v) => v !== option));
                      } else {
                        activeTab.setSelected((prev) => [...prev, option]);
                      }
                    }}
                    className={`px-3 py-2 cursor-pointer text-sm rounded-md flex items-center gap-3 transition-colors ${
                      isSelected ? 'bg-blue-50 text-blue-900' : 'hover:bg-gray-50 text-gray-700'
                    }`}
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    <div className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                      isSelected ? 'bg-blue-500 border-blue-500' : 'border-gray-300'
                    }`}>
                      {isSelected && (
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    {colors ? (
                      <span className={`${colors.bg} ${colors.text} text-xs rounded px-2 py-1 truncate`}>
                        {option}
                      </span>
                    ) : (
                      <span className="truncate">{option}</span>
                    )}
                  </li>
                );
              })}
              {getFilteredOptions(activeTab).length === 0 && (
                <li className="px-3 py-2 text-sm text-gray-500">No options found</li>
              )}
              {activeTab.maxDisplay && activeTab.options.length > activeTab.maxDisplay && (
                <li className="px-3 py-2 text-xs text-gray-400 text-center">
                  Showing first {activeTab.maxDisplay}. Type to search more...
                </li>
              )}
            </ul>
          </div>

          {totalFilters > 0 && (
            <div className="border-t border-gray-200 px-3 py-2 bg-gray-50">
              <button
                onClick={handleClearAll}
                className="w-full text-sm text-gray-600 hover:text-gray-900 py-1.5 rounded-md hover:bg-gray-100 transition-colors"
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
