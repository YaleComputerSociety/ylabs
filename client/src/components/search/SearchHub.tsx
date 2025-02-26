import React, { useState, useRef, KeyboardEvent, useEffect } from 'react';
import {Listing} from '../../types/types';
import axios from 'axios';
import swal from "sweetalert";

interface SearchHubProps {
    allDepartments: string[];
    setListings: React.Dispatch<React.SetStateAction<Listing[]>>
    setIsLoading: React.Dispatch<React.SetStateAction<Boolean>>
}

const SearchHub = ({ allDepartments, setListings, setIsLoading }: SearchHubProps) => {
    const [selectedDepartments, setSelectedDepartments] = useState<string[]>([]);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [queryString, setQueryString] = useState("");
    
    const dropdownRef = useRef<HTMLInputElement | null>(null);
    const dropdownInputRef = useRef<HTMLInputElement | null>(null);
    const dropdownButtonRef = useRef<HTMLButtonElement | null>(null);
    const searchRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if(dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setIsDropdownOpen(false);
                setSearchTerm("");
            }
        }

        document.addEventListener('mousedown', handleClickOutside);

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    useEffect(() => {
        handleSearch();
    }, [selectedDepartments, queryString])

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

    const handleSearch = () => {
        let url;

        const formattedQuery = queryString.trim().split(" ").join(",");
        url = process.env.REACT_APP_SERVER + '/listings?dept=' + selectedDepartments + '&keywords=' + formattedQuery;

        setIsLoading(true);

        axios.get(url).then((response) => {
            const responseListings : Listing[] = response.data.map(function(elem: any){
                return {
                id: elem._id,
                departments: elem.departments.join('; '),
                email: elem.email,
                website: elem.website,
                description: elem.description,
                keywords: elem.keywords,
                lastUpdated: elem.last_updated,
                name: elem.fname + ' ' + elem.lname
                }
            })
            setListings(responseListings);
            setIsLoading(false); 
        });
    }

    return (
        <div className="relative" ref={dropdownRef}>
            <div className="flex gap-4 h-11">
                <div className={`w-100 rounded-lg flex items-center transition-all duration-300 ease-in-out ${
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
                <div className="flex-1">
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
            </div>

            <div className={`mt-2 w-full bg-white rounded-lg z-10 shadow-lg border overflow-hidden transition-[max-height,border-color] duration-300 ease-in-out ${
                    isDropdownOpen ? 'max-h-48 border-gray-300' : 'max-h-0 border-transparent'
                }`}>
                <ul className={`max-h-48 p-2 overflow-y-auto`}>
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