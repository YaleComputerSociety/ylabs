import React, { useRef, useState } from 'react';

interface HiringStatusProps {
    hiringStatus: number;
    setHiringStatus: React.Dispatch<React.SetStateAction<number>>;
}

const HiringStatus = ({
    hiringStatus,
    setHiringStatus,
}: HiringStatusProps) => {
    const [isHiringDropdownOpen, setIsHiringDropdownOpen] = useState(false);
    const [focusedHiringIndex, setFocusedHiringIndex] = useState(-1);

    const hiringRef = useRef<HTMLDivElement>(null);
    const hiringInputRef = useRef<HTMLInputElement>(null);

    const hiringOptions = [
        { value: -1, label: "Lab not seeking applicants" },
        { value: 0, label: "Lab open to applicants" },
        { value: 1, label: "Lab seeking applicants" }
    ];

    const handleHiringSelect = (value: number) => {
        setHiringStatus(value);
        setIsHiringDropdownOpen(false);
        if (hiringInputRef.current) {
            hiringInputRef.current.blur();
        }
    };

    const handleHiringInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        switch(e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setFocusedHiringIndex(prev =>
                    prev < hiringOptions.length - 1 ? prev + 1 : prev
                );
                break;
            case 'ArrowUp':
                e.preventDefault();
                setFocusedHiringIndex(prev =>
                    prev > 0 ? prev - 1 : 0
                );
                break;
            case 'Enter':
                e.preventDefault();
                if (focusedHiringIndex >= 0 && focusedHiringIndex < hiringOptions.length) {
                    handleHiringSelect(hiringOptions[focusedHiringIndex].value);
                }
                break;
            case 'Escape':
                e.preventDefault();
                setIsHiringDropdownOpen(false);
                if (hiringInputRef.current) {
                    hiringInputRef.current.blur();
                }
                break;
            case 'Tab':
                setIsHiringDropdownOpen(false);
                break;
        }
    };

    return (
        <div className="mb-4" ref={hiringRef}>
            <label className="block text-gray-700 text-sm font-bold mb-2">
                ⭐ Hiring Status
            </label>

            {/* Button/display */}
            <div className="relative">
                <div className="relative">
                    <input
                        ref={hiringInputRef}
                        type="text"
                        readOnly
                        value={
                            hiringStatus === -1 ? "Lab not seeking applicants" :
                            hiringStatus === 0 ? "Lab open to applicants" :
                            "Lab seeking applicants"
                        }
                        onClick={() => {
                            setIsHiringDropdownOpen(true);
                        }}
                        onKeyDown={handleHiringInputKeyDown}
                        onFocus={() => setIsHiringDropdownOpen(true)}
                        onBlur={() => {
                            setTimeout(() => {
                                if (!hiringRef.current?.contains(document.activeElement)) {
                                    setIsHiringDropdownOpen(false);
                                }
                            }, 100)
                        }}
                        className="shadow appearance-none border rounded w-full py-2 px-3 pr-10 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                    />
                    <div
                        className="absolute inset-y-0 right-0 flex items-center px-2 text-gray-700 cursor-pointer"
                        onClick={() => {
                            setIsHiringDropdownOpen(!isHiringDropdownOpen);

                            if(!isHiringDropdownOpen && hiringInputRef.current) {
                                hiringInputRef.current.focus();
                            }
                        }}
                    >
                        <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                            <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
                        </svg>
                    </div>
                </div>

                {/* Dropdown - Moved inside the relative container */}
                {isHiringDropdownOpen && (
                    <div
                        className="absolute left-0 right-0 bg-white rounded-lg z-10 shadow-lg border overflow-hidden mt-1 max-h-[350px] border-gray-300"
                        tabIndex={-1}
                    >
                        <ul className="max-h-[350px] overflow-y-auto" tabIndex={-1}>
                            {hiringOptions.map((option, index) => (
                                <li
                                    key={index}
                                    onClick={() => handleHiringSelect(option.value)}
                                    className={`p-2 cursor-pointer flex items-center justify-between ${
                                        focusedHiringIndex === index ? 'bg-blue-100' : 'hover:bg-gray-100'
                                    }`}
                                    tabIndex={-1}
                                    onMouseDown={(e) => e.preventDefault()}
                                >
                                    <span>{option.label}</span>
                                    {hiringStatus === option.value && (
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

export default HiringStatus;