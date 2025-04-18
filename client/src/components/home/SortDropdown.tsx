import React, { useRef, useState } from 'react';

interface SortDropdownProps {
    sortBy: string;
    setSortBy: (sortBy: string) => void;
    sortOptions: {value: string, label: string}[];
    searchHub: boolean; // Add optional className prop
}

const SortDropdown = ({
    sortBy,
    setSortBy,
    sortOptions,
    searchHub
}: SortDropdownProps) => {
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [focusedIndex, setFocusedIndex] = useState(-1);

    const outerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleSelect = (value: string) => {
        setSortBy(value);
        setIsDropdownOpen(false);
        if (inputRef.current) {
            inputRef.current.blur();
        }
    };

    const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        switch(e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setFocusedIndex(prev =>
                    prev < sortOptions.length - 1 ? prev + 1 : prev
                );
                break;
            case 'ArrowUp':
                e.preventDefault();
                setFocusedIndex(prev =>
                    prev > 0 ? prev - 1 : 0
                );
                break;
            case 'Enter':
                e.preventDefault();
                if (focusedIndex >= 0 && focusedIndex < sortOptions.length) {
                    handleSelect(sortOptions[focusedIndex]['value']);
                }
                break;
            case 'Escape':
                e.preventDefault();
                setIsDropdownOpen(false);
                if (inputRef.current) {
                    inputRef.current.blur();
                }
                break;
            case 'Tab':
                setIsDropdownOpen(false);
                break;
        }
    };

    return (
        <div ref={outerRef} className={'relative'}>
            {/* Button/display */}
            <div className="relative">
                <div className={`relative ${searchHub && 'h-11'}`}>
                    <input
                        ref={inputRef}
                        type="text"
                        readOnly
                        value={sortOptions.find(option => option['value'] === sortBy)?.['label'] || ''}
                        onClick={() => {
                            setIsDropdownOpen(true);
                        }}
                        onKeyDown={handleInputKeyDown}
                        onFocus={() => setIsDropdownOpen(true)}
                        onBlur={() => {
                            setTimeout(() => {
                                if (!outerRef.current?.contains(document.activeElement)) {
                                    setIsDropdownOpen(false);
                                }
                            }, 100)
                        }}
                        className={`appearance-none border rounded w-full ${searchHub ? 'h-full': 'py-2'} px-3 pr-10 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer`}
                    />
                    <div
                        className="absolute inset-y-0 right-0 flex items-center px-2 text-gray-700 cursor-pointer"
                        onClick={() => {
                            setIsDropdownOpen(!isDropdownOpen);

                            if(!isDropdownOpen && inputRef.current) {
                                inputRef.current.focus();
                            }
                        }}
                    >
                        <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                            <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
                        </svg>
                    </div>
                </div>

                {/* Dropdown - Moved inside the relative container */}
                {isDropdownOpen && (
                    <div
                        className="absolute left-0 right-0 bg-white rounded-lg z-30 shadow-lg border overflow-hidden mt-1 max-h-[350px] border-gray-300"
                        tabIndex={-1}
                    >
                        <ul className="max-h-[350px] overflow-y-auto" tabIndex={-1}>
                            {sortOptions.map((option, index) => (
                                <li
                                    key={index}
                                    onClick={() => handleSelect(option['value'])}
                                    className={`p-2 cursor-pointer flex items-center justify-between ${
                                        focusedIndex === index ? 'bg-blue-100' : 'hover:bg-gray-100'
                                    }`}
                                    tabIndex={-1}
                                    onMouseDown={(e) => e.preventDefault()}
                                >
                                    <span>{option['label']}</span>
                                    {sortBy === option['value'] && (
                                        <svg className="h-4 w-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
                                        </svg>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SortDropdown;