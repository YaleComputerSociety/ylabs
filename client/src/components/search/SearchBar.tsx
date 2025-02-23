import React, { useState, KeyboardEvent, useRef } from 'react';

interface SearchBarProps {
    queryString: string;
    setQueryString: React.Dispatch<React.SetStateAction<string>>;
}

const SearchBar = ({ queryString, setQueryString }: SearchBarProps) => {
    const inputRef = useRef<HTMLInputElement>(null);

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter" || e.key === "Escape") {
            e.preventDefault();

            setTimeout(() => {
                inputRef.current?.blur();
                console.log("type")
            }, 0);
        }
    };
    
    return (
        <input
            ref = {inputRef}
            type="text"
            value={queryString}
            onChange={(e) => setQueryString(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search by keywords, professor name..."
            className="px-4 py-2 w-full sm:w-80 lg:w-96 xl:w-[42rem] border rounded text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-text h-11"
        />
    );
};

export default SearchBar