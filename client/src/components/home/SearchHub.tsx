import React, { useState, useRef, KeyboardEvent, useEffect } from 'react';
import { NewListing } from '../../types/types';
import axios from '../../utils/axios';
import swal from 'sweetalert';
import { createListing } from '../../utils/apiCleaner';
import { departmentCategories } from '../../utils/departmentNames';
import SortDropdown from './SortDropdown';

interface SearchHubProps {
    allDepartments: string[];
    resetListings: (listings: Listing[]) => void;
    addListings: (listings: Listing[]) => void;
    setIsLoading: React.Dispatch<React.SetStateAction<Boolean>>;
    sortBy: string;
    sortOrder: number;
    setSortBy: (sortBy: string) => void;
    setSortOrder: (sortOrder: number) => void;
    sortableKeys: string[];
    page: number;
    setPage: React.Dispatch<React.SetStateAction<number>>;
    pageSize: number;
    sortDirection: 'asc' | 'desc';
    onToggleSortDirection: () => void;
}

const SearchHub = ({
    allDepartments,
    resetListings,
    addListings,
    setIsLoading,
    sortBy,
    sortOrder,
    setSortBy,
    setSortOrder,
    sortableKeys,
    page,
    setPage,
    pageSize,
    sortDirection,
    onToggleSortDirection,
}: SearchHubProps) => {
    // Add this definition for buttonTranslations
    const buttonTranslations = [
        { value: 'default', label: 'Sort by: Best Match' },
        { value: 'updatedAt', label: 'Sort by: Last Updated' },
        { value: 'ownerLastName', label: 'Sort by: Last Name' },
        { value: 'ownerFirstName', label: 'Sort by: First Name' },
        { value: 'title', label: 'Sort by: Lab Title' }
    ];

    const [selectedDepartments, setSelectedDepartments] = useState<string[]>([]);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [queryString, setQueryString] = useState('');
    const [focusedDepartmentIndex, setFocusedDepartmentIndex] = useState(-1);

    const dropdownRef = useRef<HTMLInputElement | null>(null);
    const dropdownInputRef = useRef<HTMLInputElement | null>(null);
    const dropdownButtonRef = useRef<HTMLButtonElement | null>(null);
    const searchRef = useRef<HTMLInputElement | null>(null);

    const [queryStringLoaded, setQueryStringLoaded] = useState(false);
    const [departmentsLoaded, setDepartmentsLoaded] = useState(false);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setIsDropdownOpen(false);
                setSearchTerm('');
            }
        };

        document.addEventListener('mousedown', handleClickOutside);

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    // Initial search on mount
    useEffect(() => {
        setPage(1);
        handleSearch(1);
    }, []);

    useEffect(() => {
        const debounceTimeout = setTimeout(() => {
            if (queryStringLoaded) {
                setPage(1);
                handleSearch(1);
            }
            setQueryStringLoaded(true);
        }, 500);

        return () => {
            clearTimeout(debounceTimeout);
        };
    }, [queryString]);

    useEffect(() => {
        if (departmentsLoaded) {
            setPage(1);
            handleSearch(1);
        }
        setDepartmentsLoaded(true);
    }, [selectedDepartments, sortBy, sortOrder]);

    useEffect(() => {
        if (page > 1) {
            handleSearch(page);
        }
    }, [page]);

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setFocusedDepartmentIndex((prev) =>
                    prev < filteredDepartments.length - 1 ? prev + 1 : prev
                );
                break;
            case 'ArrowUp':
                e.preventDefault();
                setFocusedDepartmentIndex((prev) => (prev > 0 ? prev - 1 : 0));
                break;
            case 'Enter':
                e.preventDefault();
                if (
                    focusedDepartmentIndex >= 0 &&
                    focusedDepartmentIndex < filteredDepartments.length
                ) {
                    handleDepartmentSelect(filteredDepartments[focusedDepartmentIndex]);
                    setSearchTerm('');
                    setFocusedDepartmentIndex(-1);
                } else {
                    setIsDropdownOpen(false);
                    setSearchTerm('');
                    searchRef.current?.blur();
                    dropdownInputRef.current?.blur();
                }
                break;
            case 'Escape':
                e.preventDefault();
                setIsDropdownOpen(false);
                setSearchTerm('');
                dropdownInputRef.current?.blur();
                break;
        }
    };

    const handleButtonKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            dropdownButtonRef.current?.blur();
            closeDropdown();
        }
    };

    const handleDepartmentRemove = (department: string) => {
        setSelectedDepartments((prevSelected) =>
            prevSelected.filter((item) => item !== department)
        );
    };

    const handleDepartmentSelect = (department: string) => {
        if (selectedDepartments.indexOf(department) < 0) {
            setSelectedDepartments((prevSelected) => [...prevSelected, department]);
        } else {
            handleDepartmentRemove(department);
        }
    };

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchTerm(e.target.value);
    };

    const filteredDepartments = allDepartments.filter(
        (department) =>
            department.toLowerCase().includes(searchTerm.toLowerCase()) &&
            selectedDepartments.indexOf(department) < 0
    );

    const toggleDropdown = () => {
        setIsDropdownOpen(!isDropdownOpen);
        setSearchTerm('');
    };

    const openDropdown = () => {
        setIsDropdownOpen(true);
    };

    const closeDropdown = () => {
        setIsDropdownOpen(false);
        setSearchTerm('');
    };

    const handleSearch = (page: Number) => {
        let url;

        const formattedQuery = queryString.trim();
        const formattedDepartments = selectedDepartments.join(',');

        if (sortBy === 'default') {
            url = `/newListings/search?query=${formattedQuery}&page=${page}&pageSize=${pageSize}`;
        } else {
            url = `/newListings/search?query=${formattedQuery}&sortBy=${sortBy}&sortOrder=${sortOrder}&page=${page}&pageSize=${pageSize}`;
        }

        if (formattedDepartments) {
            url += `&departments=${formattedDepartments}`;
        }

        setIsLoading(true);

        axios
            .get(url, { withCredentials: true })
            .then((response) => {
                const results = response.data.results || [];
                const responseListings: NewListing[] = results.map(function (
                    elem: any
                ) {
                    return createListing(elem);
                });

                if (page == 1) {
                    resetListings(responseListings);
                } else {
                    addListings(responseListings);
                }

                setIsLoading(false);
            })
            .catch((error) => {
                console.error('Error loading listings:', error);
                swal({
                    text: 'Unable to load listings. Please try again later.',
                    icon: 'warning',
                });
                setIsLoading(false);
            });
    };

    const getDepartmentColor = (department: string) => {
        if (Object.keys(departmentCategories).includes(department)) {
            const category =
                departmentCategories[department as keyof typeof departmentCategories];
            switch (category) {
                case 0:
                    return 'bg-blue-200 text-gray-900';
                case 1:
                    return 'bg-green-200 text-gray-900';
                case 2:
                    return 'bg-yellow-200 text-gray-900';
                case 3:
                    return 'bg-red-200 text-gray-900';
                case 4:
                    return 'bg-purple-200 text-gray-900';
                case 5:
                    return 'bg-pink-200 text-gray-900';
                case 6:
                    return 'bg-teal-200 text-gray-900';
                case 7:
                    return 'bg-orange-200 text-gray-900';
                default:
                    return 'bg-gray-100 text-gray-900';
            }
        }
        return 'bg-gray-100 text-gray-900';
    };

    const handleRemoveAllDepartments = () => {
        setSelectedDepartments([]);
    };

    return (
        <div className="relative">
            <div className="flex-col flex md:flex-row md:items-center gap-4">
                <div className="md:flex-1">
                    <input
                        ref={searchRef}
                        type="text"
                        value={queryString}
                        onChange={(e) => setQueryString(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === 'Escape') {
                                e.preventDefault();
                                searchRef.current?.blur();
                            }
                        }}
                        onFocus={closeDropdown}
                        placeholder="Start your search..."
                        className="px-4 py-2 w-full border rounded text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-text h-11"
                    />
                </div>
                <div className="relative w-full md:w-[35%]" ref={dropdownRef}>
                    <button
                        ref={dropdownButtonRef}
                        onClick={toggleDropdown}
                        onKeyDown={handleButtonKeyDown}
                        className="flex items-center justify-between w-full h-11 px-3 py-2 border rounded bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <span className="truncate">Filter by department</span>
                        <svg
                            className="fill-current h-4 w-4 ml-2"
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 20 20"
                        >
                            <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
                        </svg>
                    </button>

                    {isDropdownOpen && (
                        <div className="absolute left-0 right-0 bg-white rounded-lg z-50 shadow-lg border overflow-hidden mt-1 max-h-[350px] border-gray-300">
                            <div className="p-2 border-b">
                                <input
                                    type="text"
                                    value={searchTerm}
                                    onChange={handleSearchChange}
                                    onKeyDown={handleKeyDown}
                                    placeholder="Search departments..."
                                    className="w-full px-3 py-2 border rounded text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    autoFocus
                                />
                            </div>

                            <ul className="max-h-[300px] p-1 overflow-y-auto">
                                {filteredDepartments.length > 0 ? (
                                    filteredDepartments.map((department, index) => (
                                        <li
                                            key={index}
                                            onClick={() => {
                                                handleDepartmentSelect(department);
                                                setSearchTerm('');
                                            }}
                                            className={`p-2 cursor-pointer ${
                                                focusedDepartmentIndex === index
                                                    ? 'bg-blue-100'
                                                    : 'hover:bg-gray-100'
                                            }`}
                                            onMouseDown={(e) => e.preventDefault()}
                                        >
                                            {department}
                                        </li>
                                    ))
                                ) : (
                                    <li className="p-2 text-gray-500">No departments found</li>
                                )}
                            </ul>
                        </div>
                    )}
                </div>
                <div className="hidden md:flex items-center space-x-2">
                    <SortDropdown
                        sortBy={sortBy}
                        setSortBy={setSortBy}
                        sortOptions={buttonTranslations}
                        searchHub={true}
                    />
                    {sortBy !== 'default' && (
                        <button
                            onClick={onToggleSortDirection}
                            className="flex items-center justify-center" // Match heights and add border styling
                            aria-label={sortDirection === 'asc' ? 'Sort ascending' : 'Sort descending'}
                        >
                            <svg
                                width="20"
                                height="20"
                                viewBox="0 0 24 24"
                                fill="none"
                                xmlns="http://www.w3.org/2000/svg"
                                className={`transition-transform duration-300 ease-in-out transform ${
                                    sortDirection === 'asc' ? 'rotate-0' : 'rotate-180'
                                }`}
                            >
                                <path
                                    d="M12 5l7 7-1.41 1.41L13 8.83V19h-2V8.83L6.41 13.41 5 12l7-7z"
                                    fill="currentColor"
                                />
                            </svg>
                        </button>
                    )}
                </div>
            </div>

            {selectedDepartments.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-4 w-full">
                    <span
                        className={
                            'border text-gray-700 px-2 py-1 rounded text-sm flex items-center'
                        }
                    >
                        Filters:
                    </span>
                    {selectedDepartments.map((department, index) => (
                        <span
                            key={index}
                            className={`${getDepartmentColor(
                                department
                            )} px-2 py-1 rounded text-sm flex items-center`}
                        >
                            <span className="whitespace-nowrap">{department}</span>
                            <button
                                type="button"
                                onClick={() => handleDepartmentRemove(department)}
                                className="ml-2 text-gray-500 hover:text-gray-700"
                            >
                                ×
                            </button>
                        </span>
                    ))}

                    {selectedDepartments.length >= 2 && (
                        <button
                            onClick={handleRemoveAllDepartments}
                            className="bg-red-500 hover:bg-red-600 rounded px-2 py-1 rounded text-sm flex items-center transition-colors"
                        >
                            <span className="whitespace-nowrap text-white">Remove All</span>
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

export default SearchHub;