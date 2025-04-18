import React, { useState, useRef, useEffect } from 'react';
import { departmentCategories } from '../../../../utils/departmentNames';

interface DepartmentInputProps {
  departments: string[];
  availableDepartments: string[];
  onAddDepartment: (department: string) => void;
  onRemoveDepartment: (index: number) => void;
}

const DepartmentInput = ({
  departments,
  availableDepartments,
  onAddDepartment,
  onRemoveDepartment
}: DepartmentInputProps) => {
  const [isDeptDropdownOpen, setIsDeptDropdownOpen] = useState(false);
  const [deptSearchTerm, setDeptSearchTerm] = useState('');
  const [focusedDeptIndex, setFocusedDeptIndex] = useState(-1);
  
  const deptDropdownRef = useRef<HTMLDivElement>(null);
  const deptInputRef = useRef<HTMLInputElement>(null);

  // Filter departments based on search term
  const filteredDepartments = availableDepartments.filter(dept => 
    dept.toLowerCase().includes(deptSearchTerm.toLowerCase())
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (deptDropdownRef.current && !deptDropdownRef.current.contains(e.target as Node)) {
        setIsDeptDropdownOpen(false);
        setDeptSearchTerm('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle keyboard navigation
  const handleDeptInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedDeptIndex(prev => 
          prev < filteredDepartments.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedDeptIndex(prev => prev > 0 ? prev - 1 : 0);
        break;
      case 'Enter':
        e.preventDefault();
        if (focusedDeptIndex >= 0 && focusedDeptIndex < filteredDepartments.length) {
          onAddDepartment(filteredDepartments[focusedDeptIndex]);
          setDeptSearchTerm('');
          setFocusedDeptIndex(-1);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsDeptDropdownOpen(false);
        setDeptSearchTerm('');
        if (deptInputRef.current) {
          deptInputRef.current.blur();
        }
        break;
      case 'Tab':
        setIsDeptDropdownOpen(false);
        break;
    }
  };

  // Get department color based on category
  const getDepartmentColor = (department: string) => {
    if (Object.keys(departmentCategories).includes(department)) {
      const category = departmentCategories[department as keyof typeof departmentCategories];
      switch (category) {
        case 0: return "bg-blue-200"; // Humanities
        case 1: return "bg-green-200"; // Social Sciences
        case 2: return "bg-yellow-200"; // Physical Sciences & Mathematics
        case 3: return "bg-red-200"; // Life Sciences
        case 4: return "bg-purple-200"; // Engineering & Computer Science
        case 5: return "bg-pink-200"; // Medical & Health Sciences
        case 6: return "bg-teal-200"; // Languages & Cultural Studies
        case 7: return "bg-orange-200"; // Professional & Applied Fields
        default: return "bg-gray-100";
      }
    }
    return "bg-gray-100";
  };

  return (
    <div className="mb-4" ref={deptDropdownRef}>
      <label className="block text-gray-700 text-sm font-bold mb-2">
        ⭐ Departments
      </label>
      <div className="text-xs text-gray-500 mb-2">
        Don't see your department? Let us know{" "}
        <a
            href={"https://docs.google.com/forms/d/e/1FAIpQLSf2BE6MBulJHWXhDDp3y4Nixwe6EH0Oo9X1pTo976-KrJKv5g/viewform"}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500"
        >
            here
        </a>
      </div>
      <div className="flex flex-wrap gap-2 mb-2 overflow-x-auto">
        {departments.map((department, index) => (
          <span 
            key={index} 
            className={`${getDepartmentColor(department)} text-gray-900 px-2 py-1 rounded text-sm flex items-center`}
          >
            <span className="whitespace-nowrap">
              {department}
            </span>
            <button 
              type="button" 
              onClick={() => onRemoveDepartment(index)}
              className="ml-2 text-gray-500 hover:text-gray-700"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      
      <div className="relative">
        <div className="relative">
          <input
            ref={deptInputRef}
            type="text"
            value={deptSearchTerm}
            onClick={() => setIsDeptDropdownOpen(true)}
            onChange={(e) => {
              setDeptSearchTerm(e.target.value);
              setFocusedDeptIndex(-1);
            }}
            onKeyDown={handleDeptInputKeyDown}
            onFocus={() => setIsDeptDropdownOpen(true)}
            className="shadow appearance-none border rounded w-full py-2 px-3 pr-10 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Add departments..."
          />
          <div 
            className="absolute inset-y-0 right-0 flex items-center px-2 text-gray-700 cursor-pointer"
            onClick={() => {
              if (isDeptDropdownOpen) {
                setDeptSearchTerm('');
              }
              setIsDeptDropdownOpen(!isDeptDropdownOpen);
              if (!isDeptDropdownOpen && deptInputRef.current) {
                deptInputRef.current.focus();
              }
            }}
          >
            <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
              <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
            </svg>
          </div>
        </div>

        {isDeptDropdownOpen && (
          <div 
            className="absolute w-full bg-white rounded-lg z-10 shadow-lg border overflow-hidden mt-1 max-h-[300px] md:max-h-[350px] border-gray-300"
            tabIndex={-1}
          >
            <ul className="max-h-[350px] p-1 overflow-y-auto" tabIndex={-1}>
              {filteredDepartments.length > 0 ? (
                filteredDepartments.map((dept, index) => (
                  <li
                    key={index}
                    onClick={() => {
                      onAddDepartment(dept)
                      setDeptSearchTerm('');
                    }}
                    className={`p-2 cursor-pointer ${
                      focusedDeptIndex === index ? 'bg-blue-100' : 'hover:bg-gray-100'
                    }`}
                    tabIndex={-1}
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    {dept}
                  </li>
                ))
              ) : (
                <li className="p-2 text-gray-500" tabIndex={-1}>No departments found</li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

export default DepartmentInput;