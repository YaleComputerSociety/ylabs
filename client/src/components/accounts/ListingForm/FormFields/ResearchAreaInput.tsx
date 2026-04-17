/**
 * Multi-select research area autocomplete with add-new modal.
 */
import React, { useState, useRef, useEffect, useMemo } from 'react';
import ReactDOM from 'react-dom';
import axios from 'axios';
import { useConfig } from '../../../../hooks/useConfig';

interface ResearchAreaInputProps {
  researchAreas: string[];
  onAddResearchArea: (area: string) => void;
  onRemoveResearchArea: (index: number) => void;
  error?: string;
}

interface FieldSelectorModalProps {
  isOpen: boolean;
  newAreaName: string;
  fields: Array<{ name: string; colorKey: string }>;
  onClose: () => void;
  onSelectField: (field: string) => void;
}

const colorKeyToTailwind: Record<string, { bg: string; text: string; border: string }> = {
  blue: { bg: 'bg-blue-200', text: 'text-blue-800', border: 'border-blue-300' },
  green: { bg: 'bg-green-200', text: 'text-green-800', border: 'border-green-300' },
  yellow: { bg: 'bg-yellow-200', text: 'text-yellow-800', border: 'border-yellow-300' },
  red: { bg: 'bg-red-200', text: 'text-red-800', border: 'border-red-300' },
  purple: { bg: 'bg-purple-200', text: 'text-purple-800', border: 'border-purple-300' },
  pink: { bg: 'bg-pink-200', text: 'text-pink-800', border: 'border-pink-300' },
  teal: { bg: 'bg-teal-200', text: 'text-teal-800', border: 'border-teal-300' },
  orange: { bg: 'bg-orange-200', text: 'text-orange-800', border: 'border-orange-300' },
  indigo: { bg: 'bg-indigo-200', text: 'text-indigo-800', border: 'border-indigo-300' },
  gray: { bg: 'bg-gray-200', text: 'text-gray-800', border: 'border-gray-300' },
};

const FieldSelectorModal = ({
  isOpen,
  newAreaName,
  fields,
  onClose,
  onSelectField,
}: FieldSelectorModalProps) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden">
        <div className="p-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Add New Research Area</h3>
          <p className="text-sm text-gray-600 mt-1">
            Select a field for "<span className="font-medium">{newAreaName}</span>"
          </p>
        </div>

        <div className="p-4">
          <p className="text-sm text-gray-500 mb-3">
            Choose the field that best describes this research area:
          </p>
          <div className="grid grid-cols-1 gap-2">
            {fields.map((field) => {
              const colors = colorKeyToTailwind[field.colorKey] || colorKeyToTailwind.gray;
              return (
                <button
                  key={field.name}
                  type="button"
                  onClick={() => onSelectField(field.name)}
                  className={`${colors.bg} ${colors.text} px-4 py-3 rounded-lg text-left font-medium hover:opacity-80 transition-opacity border ${colors.border}`}
                >
                  {field.name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="p-4 border-t border-gray-200 bg-gray-50">
          <button
            type="button"
            onClick={onClose}
            className="w-full px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

const ResearchAreaInput = ({
  researchAreas,
  onAddResearchArea,
  onRemoveResearchArea,
  error,
}: ResearchAreaInputProps) => {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [pendingNewArea, setPendingNewArea] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    researchAreas: allConfigAreas,
    researchFields,
    getColorForResearchArea,
    refreshConfig,
    isLoading: configLoading,
  } = useConfig();

  const existingAreaNames = useMemo(() => {
    return new Set(allConfigAreas.map((a) => a.name.toLowerCase()));
  }, [allConfigAreas]);

  const filteredAreas = useMemo(() => {
    if (!searchTerm.trim()) return [];
    return allConfigAreas.filter(
      (area) =>
        area.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
        !researchAreas.some((selected) => selected.toLowerCase() === area.name.toLowerCase()),
    );
  }, [searchTerm, allConfigAreas, researchAreas]);

  const isNewArea =
    searchTerm.trim().length > 0 &&
    !existingAreaNames.has(searchTerm.trim().toLowerCase()) &&
    !researchAreas.some((selected) => selected.toLowerCase() === searchTerm.trim().toLowerCase());

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
        setSearchTerm('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const totalItems = filteredAreas.length + (isNewArea ? 1 : 0);

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex((prev) => (prev < totalItems - 1 ? prev + 1 : prev));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex((prev) => (prev > 0 ? prev - 1 : 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (focusedIndex >= 0) {
          if (focusedIndex < filteredAreas.length) {
            handleSelectArea(filteredAreas[focusedIndex].name);
          } else if (isNewArea) {
            handleAddNewArea();
          }
        } else if (isNewArea && filteredAreas.length === 0) {
          handleAddNewArea();
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsDropdownOpen(false);
        setSearchTerm('');
        if (inputRef.current) {
          inputRef.current.blur();
        }
        break;
      case 'Tab':
        setIsDropdownOpen(false);
        break;
    }
  };

  const handleSelectArea = (areaName: string) => {
    onAddResearchArea(areaName);
    setSearchTerm('');
    setFocusedIndex(-1);
    setIsDropdownOpen(false);
  };

  const handleAddNewArea = () => {
    setPendingNewArea(searchTerm.trim());
    setIsModalOpen(true);
  };

  const handleFieldSelect = async (fieldName: string) => {
    setIsLoading(true);
    try {
      const response = await axios.post('/api/research-areas', {
        name: pendingNewArea,
        field: fieldName,
      });

      if (response.data.researchArea) {
        await refreshConfig();
        onAddResearchArea(pendingNewArea);
      }
    } catch (error: any) {
      if (error.response?.status === 409) {
        onAddResearchArea(pendingNewArea);
      } else {
        console.error('Error adding research area:', error);
        alert('Failed to add research area. Please try again.');
      }
    } finally {
      setIsLoading(false);
      setIsModalOpen(false);
      setPendingNewArea('');
      setSearchTerm('');
      setFocusedIndex(-1);
      setIsDropdownOpen(false);
    }
  };

  if (configLoading) {
    return (
      <div className="mb-4">
        <label className="block text-gray-700 text-sm font-bold mb-2">Research Areas</label>
        <div className="animate-pulse bg-gray-200 h-10 rounded"></div>
      </div>
    );
  }

  return (
    <div className="mb-4" ref={dropdownRef}>
      <label className="block text-gray-700 text-sm font-bold mb-2">Research Areas</label>
      <div className="relative">
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={searchTerm}
            onClick={() => setIsDropdownOpen(true)}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setFocusedIndex(-1);
              if (e.target.value.trim()) {
                setIsDropdownOpen(true);
              }
            }}
            onKeyDown={handleInputKeyDown}
            onFocus={() => {
              if (searchTerm.trim()) {
                setIsDropdownOpen(true);
              }
            }}
            className="shadow appearance-none border rounded w-full py-2 px-3 pr-10 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Search research areas..."
          />
          <div
            className="absolute inset-y-0 right-0 flex items-center px-2 text-gray-700 cursor-pointer"
            onClick={() => {
              if (isDropdownOpen) {
                setSearchTerm('');
              }
              setIsDropdownOpen(!isDropdownOpen);
              if (!isDropdownOpen && inputRef.current) {
                inputRef.current.focus();
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

        {isDropdownOpen && searchTerm.trim() && (
          <div
            className="absolute w-full bg-white rounded-lg z-10 shadow-lg border overflow-hidden mt-1 max-h-[300px] md:max-h-[350px] border-gray-300"
            tabIndex={-1}
          >
            <ul className="max-h-[350px] p-1 overflow-y-auto" tabIndex={-1}>
              {filteredAreas.length > 0
                ? filteredAreas.slice(0, 20).map((area, index) => {
                    const colors = colorKeyToTailwind[area.colorKey] || colorKeyToTailwind.gray;
                    return (
                      <li
                        key={`${area.name}-${index}`}
                        onClick={() => handleSelectArea(area.name)}
                        className={`p-2 cursor-pointer flex items-center justify-between ${
                          focusedIndex === index ? 'bg-blue-100' : 'hover:bg-gray-50'
                        }`}
                        tabIndex={-1}
                        onMouseDown={(e) => e.preventDefault()}
                      >
                        <span>{area.name}</span>
                        <span className={`${colors.bg} ${colors.text} text-xs px-2 py-0.5 rounded`}>
                          {area.field.split(' & ')[0]}
                        </span>
                      </li>
                    );
                  })
                : null}

              {isNewArea && (
                <li
                  onClick={handleAddNewArea}
                  className={`p-2 cursor-pointer border-t border-gray-200 ${
                    focusedIndex === filteredAreas.length ? 'bg-blue-100' : 'hover:bg-gray-50'
                  }`}
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                >
                  <div className="flex items-center text-blue-600">
                    <svg
                      className="w-4 h-4 mr-2"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 4v16m8-8H4"
                      />
                    </svg>
                    <span>
                      Add "<strong>{searchTerm.trim()}</strong>" as new research area
                    </span>
                  </div>
                </li>
              )}

              {filteredAreas.length === 0 && !isNewArea && (
                <li className="p-2 text-gray-500" tabIndex={-1}>
                  No matching research areas found
                </li>
              )}
            </ul>
          </div>
        )}
      </div>

      <div className="text-xs text-gray-500 mt-1">Type to search or add new research areas</div>

      {researchAreas.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2 overflow-x-auto">
          {researchAreas.map((area, index) => {
            const colors = getColorForResearchArea(area);
            return (
              <span
                key={index}
                className={`${colors.bg} ${colors.text} px-2 py-1 rounded text-sm flex items-center`}
              >
                <span className="whitespace-nowrap">{area}</span>
                <button
                  type="button"
                  onClick={() => onRemoveResearchArea(index)}
                  className="ml-2 text-gray-500 hover:text-gray-700"
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}

      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}

      {ReactDOM.createPortal(
        <FieldSelectorModal
          isOpen={isModalOpen}
          newAreaName={pendingNewArea}
          fields={researchFields}
          onClose={() => {
            setIsModalOpen(false);
            setPendingNewArea('');
          }}
          onSelectField={handleFieldSelect}
        />,
        document.body,
      )}

      {isLoading &&
        ReactDOM.createPortal(
          <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-[9999]">
            <div className="bg-white rounded-lg p-4 shadow-xl">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-2 text-sm text-gray-600">Adding research area...</p>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};

export default ResearchAreaInput;
