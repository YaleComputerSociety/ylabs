import React, { useRef } from 'react';
import ErrorMessage from './ErrorMessage';

interface ArrayInputProps {
    label: string;
    items: string[];
    setItems: React.Dispatch<React.SetStateAction<string[]>>;
    placeholder?: string;
    bgColor: string;
    textColor: string;
    buttonColor: string;
    error?: string;
    type?: string;
    onValidate?: (newArray: string[]) => void;
}

const ArrayInput = ({
    label,
    items,
    setItems,
    placeholder,
    bgColor,
    textColor,
    buttonColor,
    error,
    type = "text",
    onValidate
}: ArrayInputProps) => {
    const inputRef = useRef<HTMLInputElement>(null);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && inputRef.current && inputRef.current.value.trim()) {
            e.preventDefault();
            const newValue = inputRef.current.value.trim();
            
            // Skip if the item already exists
            if (!items.includes(newValue)) {
                const newArray = [...items, newValue];
                setItems(newArray);
                inputRef.current.value = '';
                
                // Validate the new array if needed
                if (onValidate) {
                    onValidate(newArray);
                }
            }
        }
    };

    const removeItem = (index: number) => {
        const newArray = [...items];
        newArray.splice(index, 1);
        setItems(newArray);
    
        // Validate the new array if needed
        if (onValidate) {
            onValidate(newArray);
        }
    };

    return (
        <div className="mb-4">
            <label className="block text-gray-700 text-sm font-bold mb-2">
                {label}
            </label>
            <div className="flex flex-wrap gap-2 mb-2 overflow-x-auto">
                {items.map((item, index) => (
                    <span 
                        key={index} 
                        className={`${bgColor} ${textColor} px-2 py-1 rounded text-sm flex items-center max-w-full`}
                    >
                        <span className="whitespace-nowrap">
                            {item}
                        </span>
                        <button 
                            type="button" 
                            onClick={() => removeItem(index)}
                            className={`ml-2 ${buttonColor}`}
                        >
                            ×
                        </button>
                    </span>
                ))}
            </div>
            <div className="flex">
                <input
                    type={type}
                    ref={inputRef}
                    placeholder={placeholder}
                    className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                    onKeyDown={handleKeyDown}
                />
            </div>
            <div className="text-xs text-gray-500 mt-1">Press Enter to add</div>
            <ErrorMessage error={error} />
        </div>
  );
};

export default ArrayInput;