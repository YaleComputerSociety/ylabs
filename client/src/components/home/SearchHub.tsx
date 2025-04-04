import React, { useState, useRef, KeyboardEvent, useEffect } from 'react';
import {NewListing} from '../../types/types';
import axios from 'axios';
import swal from 'sweetalert';
import { createListing } from '../../utils/apiCleaner';

interface SearchHubProps {
    allDepartments: string[];
    resetListings: (newListings: NewListing[]) => void;
    addListings: (newListings: NewListing[]) => void;
    setIsLoading: React.Dispatch<React.SetStateAction<Boolean>>
    sortBy: string;
    sortOrder: number;
    page: number
    setPage: React.Dispatch<React.SetStateAction<number>>
    pageSize: number;
}

const SearchHub = ({ allDepartments, resetListings, addListings, setIsLoading, sortBy, sortOrder, page, setPage, pageSize }: SearchHubProps) => {
    const [selectedDepartments, setSelectedDepartments] = useState<string[]>([]);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [queryString, setQueryString] = useState("");
    
    const dropdownRef = useRef<HTMLInputElement | null>(null);
    const dropdownInputRef = useRef<HTMLInputElement | null>(null);
    const dropdownButtonRef = useRef<HTMLButtonElement | null>(null);
    const searchRef = useRef<HTMLInputElement | null>(null);

    const [queryStringLoaded, setQueryStringLoaded] = useState(false);
    const [departmentsLoaded, setDepartmentsLoaded] = useState(false);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if(dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setIsDropdownOpen(false);
                setSearchTerm("");
            }
        }

        document.addEventListener('mousedown', handleClickOutside);

        setPage(1);
        handleSearch(1);

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
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
    }, [queryString])

    useEffect(() => {
        if (departmentsLoaded) {
            setPage(1);
            handleSearch(1);
        }
        setDepartmentsLoaded(true);
    }, [selectedDepartments, sortBy, sortOrder])

    useEffect(() => {
        if(page > 1) {
            handleSearch(page);
        }
    }, [page])

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter" || e.key === "Escape") {
            e.preventDefault();

            setTimeout(() => {
                searchRef.current?.blur();
                dropdownRef.current?.blur();
                dropdownInputRef.current?.blur();
                dropdownButtonRef.current?.blur();
                setIsDropdownOpen(false);
                setSearchTerm("");
            }, 0);
        }
    };

    const handleButtonKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            dropdownButtonRef.current?.blur();
            closeDropdown();
        }
    }

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

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchTerm(e.target.value);
    };

    const filteredDepartments = allDepartments.filter((department) => 
        department.toLowerCase().startsWith(searchTerm.toLowerCase()) && selectedDepartments.indexOf(department) < 0
    );

    const toggleDropdown = () => {
        setIsDropdownOpen(!isDropdownOpen);
        setSearchTerm("");
    };

    const openDropdown = () => {
        setIsDropdownOpen(true);
    };

    const closeDropdown = () => {
        setIsDropdownOpen(false);
        setSearchTerm("");
    };

    const handleSearch = (page: Number) => {
        let url;

        const formattedQuery = queryString.trim();
        const formattedDepartments = selectedDepartments.join(',');
        const backendBaseURL = window.location.host.includes("yalelabs.io")
            ? "https://yalelabs.io"
            : process.env.REACT_APP_SERVER;

        if (sortBy === 'default') {
            url = backendBaseURL + `/newListings/search?query=${formattedQuery}&page=${page}&pageSize=${pageSize}`;
        } else {
            url = backendBaseURL + `/newListings/search?query=${formattedQuery}&sortBy=${sortBy}&sortOrder=${sortOrder}&page=${page}&pageSize=${pageSize}`;
        }

        if (formattedDepartments) {
            url += `&departments=${formattedDepartments}`;
        }

        setIsLoading(true);

        axios.get(url, {withCredentials: true}).then((response) => {
            const responseListings : NewListing[] = response.data.results.map(function(elem: any){
                return createListing(elem);
            })

            if (page == 1) {
                resetListings(responseListings);
            } else {
                addListings(responseListings);
            }

            setIsLoading(false); 
        }).catch((error) => {
            console.error('Error loading listings:', error);
            swal({
                text: "Unable to load listings. Please try again later.",
                icon: "warning",
            })
            setIsLoading(false);
        });
    }

    return (
        <div className="relative" ref={dropdownRef}>
            <div className="flex-col flex md:flex-row gap-4">
                <div className="md:flex-1 h-11">
                    <input
                        ref = {searchRef}
                        type="text"
                        value={queryString}
                        onChange={(e) => setQueryString(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onFocus={closeDropdown}
                        placeholder="Search by keywords, professor name..."
                        className="px-4 py-2 w-full border rounded-lg text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-text h-full"
                    />
                </div>
                <div className={`w-full md:w-[45%] rounded-lg flex items-center h-11 ${
                            isDropdownOpen ? 'ring-2 ring-blue-500' : '' 
                        }`}>
                    <input
                        ref = {dropdownInputRef}
                        type="text"
                        value={searchTerm}
                        onClick={openDropdown}
                        onChange={handleSearchChange}
                        onKeyDown={handleKeyDown}
                        className={`border px-4 py-2 rounded-l-lg text-gray-700 outline-none w-full cursor-pointer h-full`}
                        placeholder="Departments... "
                    />
                    <button
                        onClick={toggleDropdown}
                        onKeyDown={handleButtonKeyDown}
                        ref = {dropdownButtonRef}
                        className={`bg-gray-300 text-gray-700 px-3 py-2 rounded-r-lg flex items-center justify-center cursor-pointer hover:bg-gray-400 h-full`}
                    >
                        <span className="text-sm">&#9660;</span> {/* Down arrow for the dropdown */}
                    </button>
                </div>
            </div>

            <div className={`mt-2 w-full bg-white rounded-lg z-10 shadow-lg border overflow-hidden transition-[max-height,border-color] duration-300 ease-in-out ${
                    isDropdownOpen ? 'max-h-[350px] border-gray-300' : 'max-h-0 border-transparent'
                }`}>
                <ul className={`max-h-[350px] p-2 overflow-y-auto`}>
                    {filteredDepartments.length > 0 ? (
                        filteredDepartments.map((department, index) => (
                            <li
                                key={index}
                                onClick={() => handleDepartmentSelect(department)}
                                className="p-2 cursor-pointer hover:bg-gray-200"
                            >
                                {department}
                            </li>
                        ))
                    ) : (
                        <li className="p-2 text-gray-500">No departments found</li>
                    )}
                </ul>
            </div>
            
            <div className={`flex flex-wrap gap-2 mt-2 transition-all duration-300 ease-in-out`}>
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
        </div>
    );
};

export default SearchHub;