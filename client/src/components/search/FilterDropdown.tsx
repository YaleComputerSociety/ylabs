import React, { useState, useRef, useEffect } from 'react';

interface FilterDropdownProps {
    allDepartments: string[];
}

const FilterDropdown = ({ allDepartments }: FilterDropdownProps) => {
    const [selectedDepartments, setSelectedDepartments] = useState<string[]>([]);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if(dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setIsDropdownOpen(false);
            }
        }

        document.addEventListener('mousedown', handleClickOutside);

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    const handleDepartmentRemove = (department: string) => {
        setSelectedDepartments((prevSelected) => prevSelected.filter((item) => item !== department));
    };

    const handleDepartmentSelect = (department: string) => {
        if (selectedDepartments.indexOf(department) < 0) {
            setSelectedDepartments((prevSelected) => [...prevSelected, department]);
        } else {
            handleDepartmentRemove(department);
        }
        
    };

    const toggleDropdown = () => {
        setIsDropdownOpen(!isDropdownOpen);
    };

    return (
        <div className="relative" ref={dropdownRef}>
            <div className="flex flex-wrap gap-2 mb-2">
                {selectedDepartments.map((department, index) => (
                    <div
                        key={index}
                        className="flex items-center px-3 p-1 bg-blue-500 text-white rounded-full cursor-pointer"
                        onClick={() => handleDepartmentRemove(department)}
                    >
                        {department} <span className="ml-2 text-xs">&times;</span>
                    </div>
                ))}
            </div>

            <button
                onClick={toggleDropdown}
                className="px-4 py-2 bg-gray-300 rounded-lg text-gray-700"
            >
                Departments
            </button>

            {isDropdownOpen && (
                <div className="absolute mt-2 w-full bg-white border border-gray-300 rounded-lg shadow-lg z-10">
                    <ul className="max-h-48 overflow-y-auto p-2">
                        {allDepartments.filter((item) => selectedDepartments.indexOf(item) < 0).map((department, index) => (
                            <li
                                key={index}
                                onClick={() => handleDepartmentSelect(department)}
                                className="p-2 cursor-pointer hover:bg-gray-200"
                            >
                                {department}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};

export default FilterDropdown;