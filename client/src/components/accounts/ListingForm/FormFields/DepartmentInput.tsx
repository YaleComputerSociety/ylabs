/**
 * Multi-select department autocomplete dropdown with chips.
 */
import React, { useReducer, useRef, useEffect } from 'react';
import { useConfig } from '../../../../hooks/useConfig';
import {
  createInitialDepartmentInputState,
  departmentInputReducer,
} from '../../../../reducers/departmentInputReducer';

interface DepartmentInputProps {
  departments: string[];
  availableDepartments: string[];
  onAddDepartment: (department: string) => void;
  onRemoveDepartment: (index: number) => void;
  required?: boolean;
  error?: string;
  label?: string;
}

const DepartmentInput = ({
  departments,
  availableDepartments,
  onAddDepartment,
  onRemoveDepartment,
  required = false,
  error,
  label = 'Department Affiliation',
}: DepartmentInputProps) => {
  const [state, dispatch] = useReducer(
    departmentInputReducer,
    undefined,
    createInitialDepartmentInputState,
  );
  const { isDeptDropdownOpen, deptSearchTerm, focusedDeptIndex } = state;

  const { getDepartmentColor, isLoading: configLoading } = useConfig();

  const deptDropdownRef = useRef<HTMLDivElement>(null);
  const deptInputRef = useRef<HTMLInputElement>(null);

  const filteredDepartments = availableDepartments.filter((dept) =>
    dept.toLowerCase().includes(deptSearchTerm.toLowerCase()),
  );

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (deptDropdownRef.current && !deptDropdownRef.current.contains(e.target as Node)) {
        dispatch({ type: 'CLOSE_DROPDOWN' });
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleDeptInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        dispatch({
          type: 'SET_FOCUSED_INDEX',
          payload: (prev) => (prev < filteredDepartments.length - 1 ? prev + 1 : prev),
        });
        break;
      case 'ArrowUp':
        e.preventDefault();
        dispatch({
          type: 'SET_FOCUSED_INDEX',
          payload: (prev) => (prev > 0 ? prev - 1 : 0),
        });
        break;
      case 'Enter':
        e.preventDefault();
        if (focusedDeptIndex >= 0 && focusedDeptIndex < filteredDepartments.length) {
          onAddDepartment(filteredDepartments[focusedDeptIndex]);
          dispatch({ type: 'SET_SEARCH', payload: '' });
        }
        break;
      case 'Escape':
        e.preventDefault();
        dispatch({ type: 'CLOSE_DROPDOWN' });
        if (deptInputRef.current) {
          deptInputRef.current.blur();
        }
        break;
      case 'Tab':
        dispatch({ type: 'CLOSE_DROPDOWN' });
        break;
    }
  };

  if (configLoading) {
    return (
      <div className="mb-4">
        <label className="block text-gray-700 text-sm font-bold mb-2">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
        <div className="animate-pulse bg-gray-200 h-10 rounded"></div>
      </div>
    );
  }

  return (
    <div className="mb-4" ref={deptDropdownRef}>
      <label className="block text-gray-700 text-sm font-bold mb-2">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      <div className="relative">
        <div className="relative">
          <input
            ref={deptInputRef}
            type="text"
            value={
              isDeptDropdownOpen
                ? deptSearchTerm
                : departments.length > 0
                  ? departments.join(', ')
                  : ''
            }
            onClick={() => {
              dispatch({ type: 'OPEN_DROPDOWN' });
            }}
            onChange={(e) => {
              dispatch({ type: 'SET_SEARCH', payload: e.target.value });
            }}
            onKeyDown={handleDeptInputKeyDown}
            onFocus={() => {
              dispatch({ type: 'OPEN_DROPDOWN' });
            }}
            readOnly={!isDeptDropdownOpen}
            className={`shadow appearance-none border rounded w-full py-2 px-3 pr-10 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 truncate ${
              !isDeptDropdownOpen && departments.length > 0 ? 'text-gray-900' : 'text-gray-700'
            }`}
            placeholder="Add departments..."
          />
          <div
            className="absolute inset-y-0 right-0 flex items-center px-2 text-gray-700 cursor-pointer"
            onClick={() => {
              if (isDeptDropdownOpen) {
                dispatch({ type: 'CLOSE_DROPDOWN' });
              } else {
                dispatch({ type: 'OPEN_DROPDOWN' });
                if (deptInputRef.current) {
                  deptInputRef.current.focus();
                }
              }
            }}
          >
            <svg
              className="fill-current h-4 w-4"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
            >
              <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
            </svg>
          </div>
        </div>

        {isDeptDropdownOpen && (
          <div
            className="absolute w-full bg-white rounded-lg z-10 shadow-lg border overflow-hidden mt-1 border-gray-300"
            tabIndex={-1}
          >
            {departments.length > 0 && (
              <div className="flex flex-wrap gap-2 p-2 border-b border-gray-200 bg-gray-50">
                {departments.map((department, index) => (
                  <span
                    key={index}
                    className={`${getDepartmentColor(department)} text-gray-900 px-2 py-1 rounded text-sm flex items-center`}
                  >
                    <span className="whitespace-nowrap">{department}</span>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onRemoveDepartment(index)}
                      className="ml-2 text-gray-500 hover:text-gray-700"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <ul className="max-h-[250px] p-1 overflow-y-auto" tabIndex={-1}>
              {filteredDepartments.length > 0 ? (
                filteredDepartments.map((dept, index) => (
                  <li
                    key={index}
                    onClick={() => {
                      onAddDepartment(dept);
                      dispatch({ type: 'SET_SEARCH', payload: '' });
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
                <li className="p-2 text-gray-500" tabIndex={-1}>
                  No departments found
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
      <div className="text-xs text-gray-500 mt-1">
        Don't see your department? Let us know{' '}
        <a
          href={
            'https://docs.google.com/forms/d/e/1FAIpQLSf2BE6MBulJHWXhDDp3y4Nixwe6EH0Oo9X1pTo976-KrJKv5g/viewform'
          }
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-500"
        >
          here
        </a>
      </div>
      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  );
};

export default DepartmentInput;
