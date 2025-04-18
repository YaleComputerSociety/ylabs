import React, { useRef, useState } from 'react';
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
    permanentValue?: string;
    onValidate?: (newArray: string[]) => void;
    infoText?: string;
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
    permanentValue,
    onValidate,
    infoText
}: ArrayInputProps) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const [showTooltip, setShowTooltip] = useState(false);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && inputRef.current && inputRef.current.value.trim()) {
            e.preventDefault();
            const newValue = inputRef.current.value.trim();
            
            // Skip if the item already exists
            if (!items.includes(newValue) && (!permanentValue || newValue !== permanentValue)) {
                const newArray = [...items, newValue];
                setItems(newArray);
                inputRef.current.value = '';
                
                // Validate the new array if needed
                if (onValidate) {
                    if (permanentValue) {
                        onValidate([...newArray, permanentValue]);
                    } else {
                        onValidate(newArray);
                    }
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
            if (permanentValue) {
                onValidate([...newArray, permanentValue]);
            } else {
                onValidate(newArray);
            }
        }
    };

    // Render items to display - if permanentValue is provided, render it separately
    const renderItems = () => {
        // First render permanentValue if it exists
        const elements = [];
        
        if (permanentValue) {
            elements.push(
                <span 
                    key="permanent" 
                    className={`${bgColor} ${textColor} px-2 py-1 rounded text-sm flex items-center`}
                >
                    <span className="whitespace-nowrap">
                        {permanentValue}
                    </span>
                    <div 
                        className="ml-2 w-4 h-4 relative"
                        onMouseEnter={() => setShowTooltip(true)}
                        onMouseLeave={() => setShowTooltip(false)}
                    >
                        <div className="rounded-full border border-current flex items-center justify-center w-full h-full cursor-pointer">
                            <span className="text-xs">?</span>
                        </div>
                        {showTooltip && (
                            <div className="absolute left-6 -top-1 bg-gray-800 text-white text-xs rounded py-1 px-2 whitespace-nowrap z-10">
                                Creator
                            </div>
                        )}
                    </div>
                </span>
            );
        }
        
        // Then render the rest of the items
        items.forEach((item, index) => {
            // Skip if this item is the permanent value
            if (permanentValue === item) return;
            
            elements.push(
                <span 
                    key={index} 
                    className={`${bgColor} ${textColor} px-2 py-1 rounded text-sm flex items-center`}
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
            );
        });
        
        return elements;
    };

    return (
        <div className="mb-4">
            <label className="block text-gray-700 text-sm font-bold mb-2">
                {label}
            </label>
            {infoText && (
                <div className="text-xs text-gray-500 mb-2">
                    {infoText}
                </div>
            )}
            <div className="flex flex-wrap gap-2 mb-2 overflow-x-auto">
                {renderItems()}
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