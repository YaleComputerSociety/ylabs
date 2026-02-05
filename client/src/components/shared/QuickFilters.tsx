import React from 'react';

export interface QuickFilterOption {
    label: string;
    value: string;
    icon?: React.ReactNode;
}

interface QuickFiltersProps {
    options: QuickFilterOption[];
    activeFilter: string | null;
    onFilterChange: (value: string | null) => void;
}

const QuickFilters: React.FC<QuickFiltersProps> = ({ options, activeFilter, onFilterChange }) => {
    return (
        <div className="flex flex-wrap gap-2 mb-4">
            <span className="text-xs text-gray-500 self-center mr-1">Quick filters:</span>
            {options.map((option) => {
                const isActive = activeFilter === option.value;
                return (
                    <button
                        key={option.value}
                        onClick={() => onFilterChange(isActive ? null : option.value)}
                        className={`
                            inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full
                            transition-all duration-200 border
                            ${isActive
                                ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-600'
                            }
                        `}
                    >
                        {option.icon}
                        {option.label}
                        {isActive && (
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                        )}
                    </button>
                );
            })}
        </div>
    );
};

export default QuickFilters;
