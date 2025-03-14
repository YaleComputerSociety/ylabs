import React, { useState, useEffect, useRef, KeyboardEvent } from 'react';
import { NewListing } from '../../types/types';
import { departmentCategories, departmentNames } from '../../utils/departmentNames';
import swal from "sweetalert";

interface ListingFormProps {
  listing: NewListing;
  onCancel?: () => void;
  onSave?: (updatedListing: NewListing) => void;
}

const ListingForm = ({ listing, onCancel, onSave }: ListingFormProps) => {
  // Form state
  const [title, setTitle] = useState(listing.title);
  const [professorNames, setProfessorNames] = useState<string[]>([...listing.professorNames]);
  const [departments, setDepartments] = useState<string[]>([...listing.departments]);
  const [availableDepartments, setAvailableDepartments] = useState<string[]>([]);
  const [emails, setEmails] = useState<string[]>([...listing.emails]);
  const [websites, setWebsites] = useState<string[]>(listing.websites ? [...listing.websites] : []);
  const [description, setDescription] = useState(listing.description);
  const [keywords, setKeywords] = useState<string[]>(listing.keywords ? [...listing.keywords] : []);
  const [established, setEstablished] = useState(listing.established || '');
  const [hiringStatus, setHiringStatus] = useState(listing.hiringStatus);
  const [archived, setArchived] = useState(listing.archived);
  
  // Department dropdown state
  const [isDeptDropdownOpen, setIsDeptDropdownOpen] = useState(false);
  const [deptSearchTerm, setDeptSearchTerm] = useState('');
  const [focusedDeptIndex, setFocusedDeptIndex] = useState(-1);
  
  // Refs
  const professorInputRef = useRef<HTMLInputElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const websiteInputRef = useRef<HTMLInputElement>(null);
  const keywordInputRef = useRef<HTMLInputElement>(null);
  const deptDropdownRef = useRef<HTMLDivElement>(null);
  const deptInputRef = useRef<HTMLInputElement>(null);

  // Add these new state variables
  const [isHiringDropdownOpen, setIsHiringDropdownOpen] = useState(false);
  const [focusedHiringIndex, setFocusedHiringIndex] = useState(-1);
  const hiringRef = useRef<HTMLDivElement>(null);
  const hiringInputRef = useRef<HTMLInputElement>(null);

  // Add these to the component's state variables
  const [errors, setErrors] = useState<{
    title?: string;
    description?: string;
    established?: string;
    professorNames?: string;
    emails?: string;
    websites?: string;
  }>({});

  // Initialize available departments (removing already selected ones)
  useEffect(() => {
    setAvailableDepartments(
      departmentNames.filter(dept => !departments.includes(dept)).sort()
    );
  }, []);

  // Close department dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (deptDropdownRef.current && !deptDropdownRef.current.contains(e.target as Node)) {
        setIsDeptDropdownOpen(false);
        setDeptSearchTerm("");
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Add validation utility functions
  const validateTitle = (value: string): string | undefined => {
    return value.trim() ? undefined : "Title is required";
  };

  const validateDescription = (value: string): string | undefined => {
    return value.trim() ? undefined : "Description is required";
  };

  const validateEstablished = (value: string): string | undefined => {
    if (!value) return undefined; // Not required
    
    const year = parseInt(value, 10);
    const currentYear = new Date().getFullYear();
    
    if (isNaN(year) || !Number.isInteger(year)) {
      return "Year must be a valid integer";
    }
    
    if (year < 1701) {
      return `Yale wasn't established until 1701!`;
    }

    if (year > currentYear) {
        return `Year cannot be in the future`;
    }

    if (value.trim().includes(" ")) {
        return `Year cannot include spaces`;
    }

    if (year.toString() != value.trim()) {
        return `Year cannot include non-numeric characters`;
    }
    
    return undefined;
  };

  const validateProfessors = (professors: string[]): string | undefined => {
    return professors.length > 0 ? undefined : "At least one professor is required";
  };

  const validateEmails = (emails: string[]): string | undefined => {
    if (emails.length === 0) {
      return "At least one email is required";
    }
    
    for (const email of emails) {
      if (!email.includes('@') || !email.includes('.') || email.includes(' ')) {
        return `Invalid email format: ${email}`;
      }
    }
    
    return undefined;
  };

  const validateWebsites = (websites: string[]): string | undefined => {
    if (websites.length === 0) return undefined; // Not required
    
    for (const website of websites) {
      if (!website.includes('.') || website.includes(' ')) {
        return `Invalid website format: ${website}`;
      }
    }
    
    return undefined;
  };

  // Add this function to handle hiring status selection
  const handleHiringSelect = (value: number) => {
    setHiringStatus(value);
    setIsHiringDropdownOpen(false);
    
    // Blur the input field after selection
    if (hiringInputRef.current) {
      hiringInputRef.current.blur();
    }
  };

  // Add this function for keyboard navigation
  const handleHiringInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const hiringOptions = [
      { value: -1, label: "Lab not seeking applicants" },
      { value: 0, label: "Lab open to applicants" },
      { value: 1, label: "Lab seeking applicants" },
    ];
    
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedHiringIndex(prev => 
          prev < hiringOptions.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedHiringIndex(prev => prev > 0 ? prev - 1 : 0);
        break;
      case 'Enter':
        e.preventDefault();
        if (focusedHiringIndex >= 0 && focusedHiringIndex < hiringOptions.length) {
          handleHiringSelect(hiringOptions[focusedHiringIndex].value);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsHiringDropdownOpen(false);
        if (hiringInputRef.current) {
          hiringInputRef.current.blur();
        }
        break;
      case 'Tab':
        setIsHiringDropdownOpen(false);
        break;
    }
  };

  // Helper functions for array fields
  const handleArrayInput = (
    e: React.KeyboardEvent<HTMLInputElement>,
    array: string[],
    setArray: React.Dispatch<React.SetStateAction<string[]>>,
    inputRef: React.RefObject<HTMLInputElement>,
    type?: 'professor' | 'email' | 'website' | 'keyword'
  ) => {
    if (e.key === 'Enter' && inputRef.current && inputRef.current.value.trim()) {
      e.preventDefault();
      const newValue = inputRef.current.value.trim();
      
      // Validate based on type
      if (type === 'email' && (!newValue.includes('@') || !newValue.includes('.') || newValue.includes(' '))) {
        setErrors(prev => ({ ...prev, emails: `Invalid email format: ${newValue}` }));
        return;
      } else if (type === 'website' && (!newValue.includes('.') || newValue.includes(' '))) {
        setErrors(prev => ({ ...prev, websites: `Invalid website format: ${newValue}` }));
        return;
      }
      
      if (!array.includes(newValue)) {
        const newArray = [...array, newValue];
        setArray(newArray);
        inputRef.current.value = '';
        
        // Clear errors if we've fixed the issue
        if (type === 'professor') {
          setErrors(prev => ({ ...prev, professorNames: validateProfessors(newArray) }));
        } else if (type === 'email') {
          setErrors(prev => ({ ...prev, emails: validateEmails(newArray) }));
        } else if (type === 'website') {
          setErrors(prev => ({ ...prev, websites: validateWebsites(newArray) }));
        }
      }
    }
  };

  const removeArrayItem = (
    index: number,
    array: string[],
    setArray: React.Dispatch<React.SetStateAction<string[]>>,
    type?: 'professor' | 'email' | 'website'
  ) => {
    const newArray = [...array];
    const removedItem = newArray.splice(index, 1)[0];
    setArray(newArray);
    
    // If it's a department, add it back to available departments
    if (array === departments) {
      setAvailableDepartments(prev => [...prev, removedItem].sort());
    }
    
    // Check validation after removal
    if (type === 'professor') {
      setErrors(prev => ({ ...prev, professorNames: validateProfessors(newArray) }));
    } else if (type === 'email') {
      setErrors(prev => ({ ...prev, emails: validateEmails(newArray) }));
    } else if (type === 'website') {
      setErrors(prev => ({ ...prev, websites: validateWebsites(newArray) }));
    }
  };

  // Department dropdown handling
  const handleDepartmentSelect = (department: string) => {
    if (!departments.includes(department)) {
      // Add to departments
      setDepartments(prev => [...prev, department]);
      // Remove from available departments
      setAvailableDepartments(prev => prev.filter(dept => dept !== department));
      // Reset search term
      setDeptSearchTerm('');
      // Keep dropdown open and focus input
      if (deptInputRef.current) {
        deptInputRef.current.focus();
      }
    }
  };
  
  const handleDeptInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const filteredDepts = availableDepartments.filter(dept => 
      dept.toLowerCase().includes(deptSearchTerm.toLowerCase())
    );
    
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedDeptIndex(prev => 
          prev < filteredDepts.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedDeptIndex(prev => prev > 0 ? prev - 1 : 0);
        break;
      case 'Enter':
        e.preventDefault();
        if (focusedDeptIndex >= 0 && focusedDeptIndex < filteredDepts.length) {
          handleDepartmentSelect(filteredDepts[focusedDeptIndex]);
          setFocusedDeptIndex(-1);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsDeptDropdownOpen(false);
        setDeptSearchTerm('');
        // Unfocus the input
        if (deptInputRef.current) {
          deptInputRef.current.blur();
        }
        break;
      case 'Tab':
        // Close the dropdown when tabbing out, don't prevent default behavior
        setIsDeptDropdownOpen(false);
        setDeptSearchTerm('');
        break;
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate all required fields
    const validationErrors = {
      title: validateTitle(title),
      description: validateDescription(description),
      established: validateEstablished(established),
      professorNames: validateProfessors(professorNames),
      emails: validateEmails(emails),
      websites: validateWebsites(websites)
    };
    
    // Filter out undefined errors
    const filteredErrors = Object.fromEntries(
      Object.entries(validationErrors).filter(([_, value]) => value !== undefined)
    );
    
    // Update error state
    setErrors(filteredErrors);
    
    // Only proceed if no errors
    if (Object.keys(filteredErrors).length === 0) {
      const updatedListing: NewListing = {
        ...listing,
        title,
        professorNames,
        departments,
        emails,
        websites,
        description,
        keywords,
        established,
        hiringStatus,
        archived
      };
      
      console.log('Updated Listing:', updatedListing);
      
      // Show confirmation dialog before saving
      swal({
        title: "Submit Form",
        text: "Are you sure you want to save these changes?",
        icon: "info",
        buttons: ["Cancel", "Save"],
      }).then((willSave) => {
        if (willSave && onSave) {
          onSave(updatedListing);
        }
      });
    } else {
      console.log('Validation errors:', filteredErrors);
    }
  };

  const handleCancel = () => {
    console.log('cancel');
    if (onCancel) {
      onCancel();
    }
  };

  // Helper function to get department color based on category
  const getDepartmentColor = (department: string) => {
    if (Object.keys(departmentCategories).includes(department)) {
      const category = departmentCategories[department as keyof typeof departmentCategories];
      switch (category) {
        case 0: return "bg-blue-100 text-blue-800"; // Humanities
        case 1: return "bg-green-100 text-green-800"; // Social Sciences
        case 2: return "bg-yellow-100 text-yellow-800"; // Physical Sciences & Mathematics
        case 3: return "bg-purple-100 text-purple-800"; // Life Sciences
        case 4: return "bg-red-100 text-red-800"; // Engineering & Computer Science
        case 5: return "bg-pink-100 text-pink-800"; // Medical & Health Sciences
        case 6: return "bg-indigo-100 text-indigo-800"; // Languages & Cultural Studies
        case 7: return "bg-teal-100 text-teal-800"; // Professional & Applied Fields
        default: return "bg-gray-100 text-gray-800";
      }
    }
    return "bg-gray-100 text-gray-800";
  };

  const filteredDepartments = availableDepartments.filter(dept => 
    dept.toLowerCase().includes(deptSearchTerm.toLowerCase())
  );

  // Simple error display component
  const ErrorMessage = ({ error }: { error?: string }) => {
    if (!error) return null;
    return <div className="text-red-500 text-xs mt-1">{error}</div>;
  };

  return (
    <div className="border border-gray-300 border-t-0 bg-white p-6 rounded-b-lg shadow-md relative">
      <form 
        onSubmit={handleSubmit}
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
          {/* Left column - Non-array fields */}
          <div className="col-span-1">
            {/* Title */}
            <div className="mb-4">
              <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="title">
                Listing Title
              </label>
              <input
                id="title"
                type="text"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (errors.title) {
                    setErrors(prev => ({ ...prev, title: validateTitle(e.target.value) }));
                  }
                }}
                placeholder="Add title"
                className={`shadow appearance-none border ${errors.title ? 'border-red-500' : ''} rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline whitespace-nowrap overflow-x-auto`}
              />
              <ErrorMessage error={errors.title} />
            </div>

            {/* Description */}
            <div className="mb-4">
              <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="description">
                Description
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add description"
                className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline overflow-x-auto"
                rows={10}
              />
              <ErrorMessage error={errors.description} />
            </div>
            
            {/* Established */}
            <div className="mb-4">
              <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="established">
                Lab Established Year
              </label>
              <input
                id="established"
                type="text"
                value={established}
                onChange={(e) => {
                  setEstablished(e.target.value);
                  if (errors.established) {
                    setErrors(prev => ({ ...prev, established: validateEstablished(e.target.value) }));
                  }
                }}
                placeholder="e.g. 2006"
                className={`shadow appearance-none border ${errors.established ? 'border-red-500' : ''} rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline overflow-x-auto`}
              />
              <ErrorMessage error={errors.established} />
            </div>
          </div>
          
          {/* Right columns - Array fields (col-span-2) */}
          <div className="col-span-1 md:col-span-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left array column */}
              <div>
                {/* Professors */}
                <div className="mb-4">
                  <label className="block text-gray-700 text-sm font-bold mb-2">
                    Professors
                  </label>
                  <div className="flex flex-wrap gap-2 mb-2 overflow-x-auto">
                    {professorNames.map((name, index) => (
                      <span 
                        key={index} 
                        className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm flex items-center max-w-full"
                      >
                        <span className="whitespace-nowrap">
                          {name}
                        </span>
                        <button 
                          type="button" 
                          onClick={() => removeArrayItem(index, professorNames, setProfessorNames, 'professor')}
                          className="ml-2 text-blue-500 hover:text-blue-700"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex">
                    <input
                      type="text"
                      ref={professorInputRef}
                      placeholder="Add professor"
                      className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                      onKeyDown={(e) => handleArrayInput(e, professorNames, setProfessorNames, professorInputRef, 'professor')}
                    />
                  </div>
                  <div className="text-xs text-gray-500 mt-1">Press Enter to add</div>
                  <ErrorMessage error={errors.professorNames} />
                </div>

                {/* Contact Info */}
                <div className="mb-4">
                  <label className="block text-gray-700 text-sm font-bold mb-2">
                    Emails
                  </label>
                  <div className="flex flex-wrap gap-2 mb-2 overflow-x-auto">
                    {emails.map((email, index) => (
                      <span 
                        key={index} 
                        className="bg-green-100 text-green-800 px-2 py-1 rounded text-sm flex items-center"
                      >
                        <span className="whitespace-nowrap">
                          {email}
                        </span>
                        <button 
                          type="button" 
                          onClick={() => removeArrayItem(index, emails, setEmails, 'email')}
                          className="ml-2 text-green-500 hover:text-green-700"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex">
                    <input
                      type="email"
                      ref={emailInputRef}
                      placeholder="Add email"
                      className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                      onKeyDown={(e) => handleArrayInput(e, emails, setEmails, emailInputRef, 'email')}
                    />
                  </div>
                  <div className="text-xs text-gray-500 mt-1">Press Enter to add</div>
                  <ErrorMessage error={errors.emails} />
                </div>

                {/* Hiring Status - Custom Dropdown */}
                <div className="mb-4" ref={hiringRef}>
                  <label className="block text-gray-700 text-sm font-bold mb-2">
                    Hiring Status
                  </label>
                  <div className="relative">
                    {/* Custom dropdown input */}
                    <div className="relative">
                      <input
                        ref={hiringInputRef}
                        type="text"
                        readOnly
                        value={
                          hiringStatus === -1 ? "Lab not seeking applicants" :
                          hiringStatus === 0 ? "Lab open to applicants" :
                          "Lab seeking applicants"
                        }
                        onClick={() => {
                          // Always open the dropdown when clicking the input (don't toggle)
                          setIsHiringDropdownOpen(true);
                          // No need to focus, onClick on the input already focuses it
                        }}
                        onKeyDown={handleHiringInputKeyDown}
                        onFocus={() => setIsHiringDropdownOpen(true)}
                        onBlur={() => {
                          setTimeout(() => {
                            if (!hiringRef.current?.contains(document.activeElement)) {
                              setIsHiringDropdownOpen(false);
                            }
                          }, 100);
                        }}
                        className="shadow appearance-none border rounded w-full py-2 px-3 pr-10 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                      />
                      <div 
                        className="absolute inset-y-0 right-0 flex items-center px-2 text-gray-700 cursor-pointer"
                        onClick={() => {
                          setIsHiringDropdownOpen(!isHiringDropdownOpen);
                          
                          if (!isHiringDropdownOpen && hiringInputRef.current) {
                            hiringInputRef.current.focus();
                          }
                        }}
                      >
                        <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                          <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
                        </svg>
                      </div>
                    </div>

                    {/* Dropdown menu - Only render when open */}
                    {isHiringDropdownOpen && (
                      <div 
                        className="absolute w-full bg-white rounded-lg z-10 shadow-lg border overflow-hidden mt-1 max-h-[350px] border-gray-300"
                        tabIndex={-1}
                      >
                        <ul className="max-h-[350px] overflow-y-auto" tabIndex={-1}>
                          {[
                            { value: -1, label: "Lab not seeking applicants" },
                            { value: 0, label: "Lab open to applicants" },
                            { value: 1, label: "Lab seeking applicants" },
                          ].map((option, index) => (
                            <li
                              key={index}
                              onClick={() => handleHiringSelect(option.value)}
                              className={`p-2 cursor-pointer flex items-center justify-between ${
                                focusedHiringIndex === index ? 'bg-blue-100' : 'hover:bg-gray-100'
                              }`}
                              tabIndex={-1}
                              onMouseDown={(e) => e.preventDefault()} // Prevent blur on click
                            >
                              <span>{option.label}</span>
                              {hiringStatus === option.value && (
                                <svg className="h-4 w-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
                                </svg>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>

                {/* Archived - Moved to right columns */}
                <div className="mb-6 flex items-center">
                  <input
                    id="archived"
                    type="checkbox"
                    checked={archived}
                    onChange={(e) => setArchived(e.target.checked)}
                    className="mr-3 h-4 w-4 text-blue-500 focus:ring-blue-400 cursor-pointer"
                  />
                  <label className="text-gray-700 text-sm font-bold cursor-pointer" htmlFor="archived">
                    Archive this listing
                  </label>
                </div>
              </div>

              {/* Right array column */}
              <div>
                {/* Departments - with custom dropdown */}
                <div className="mb-4" ref={deptDropdownRef}>
                  <label className="block text-gray-700 text-sm font-bold mb-2">
                    Departments
                  </label>
                  <div className="flex flex-wrap gap-2 mb-2 overflow-x-auto">
                    {departments.map((department, index) => (
                      <span 
                        key={index} 
                        className={`${getDepartmentColor(department)} px-2 py-1 rounded text-sm flex items-center`}
                      >
                        <span className="whitespace-nowrap">
                          {department}
                        </span>
                        <button 
                          type="button" 
                          onClick={() => removeArrayItem(index, departments, setDepartments)}
                          className="ml-2 text-gray-500 hover:text-gray-700"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  
                  <div className="relative">
                    {/* SearchHub-style dropdown with seamless chevron */}
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
                        onBlur={() => {
                          // Always close dropdown and clear search after a short delay
                          // The delay is needed to ensure click events on dropdown items are processed first
                          setTimeout(() => {
                            if (!deptDropdownRef.current?.contains(document.activeElement)) {
                              setIsDeptDropdownOpen(false);
                              setDeptSearchTerm('');
                            }
                          }, 100);
                        }}
                        className="shadow appearance-none border rounded w-full py-2 px-3 pr-10 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Add departments..."
                      />
                      <div 
                        className="absolute inset-y-0 right-0 flex items-center px-2 text-gray-700 cursor-pointer"
                        onClick={() => {
                          // If dropdown is currently open, clear search term when closing
                          if (isDeptDropdownOpen) {
                            setDeptSearchTerm('');
                          }
                          
                          setIsDeptDropdownOpen(!isDeptDropdownOpen);
                          
                          // Focus the input when opening
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

                    {/* Dropdown menu - Only render when open to avoid tab traps */}
                    {isDeptDropdownOpen && (
                      <div 
                        className="absolute w-full bg-white rounded-lg z-10 shadow-lg border overflow-hidden mt-1 max-h-[350px] border-gray-300"
                        tabIndex={-1}
                      >
                        <ul className="max-h-[350px] p-1 overflow-y-auto" tabIndex={-1}>
                          {filteredDepartments.length > 0 ? (
                            filteredDepartments.map((dept, index) => (
                              <li
                                key={index}
                                onClick={() => handleDepartmentSelect(dept)}
                                className={`p-2 cursor-pointer ${
                                  focusedDeptIndex === index ? 'bg-blue-100' : 'hover:bg-gray-100'
                                }`}
                                tabIndex={-1}
                                onMouseDown={(e) => e.preventDefault()} // Prevent blur on click
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
                
                {/* Websites */}
                <div className="mb-4">
                  <label className="block text-gray-700 text-sm font-bold mb-2">
                    Websites
                  </label>
                  <div className="flex flex-wrap gap-2 mb-2 overflow-x-auto">
                    {websites.map((website, index) => (
                      <span 
                        key={index} 
                        className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded text-sm flex items-center"
                      >
                        <span className="whitespace-nowrap">
                          {website}
                        </span>
                        <button 
                          type="button" 
                          onClick={() => removeArrayItem(index, websites, setWebsites, 'website')}
                          className="ml-2 text-yellow-500 hover:text-yellow-700"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex">
                    <input
                      type="url"
                      ref={websiteInputRef}
                      placeholder="Add website URL"
                      className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                      onKeyDown={(e) => handleArrayInput(e, websites, setWebsites, websiteInputRef, 'website')}
                    />
                  </div>
                  <div className="text-xs text-gray-500 mt-1">Press Enter to add</div>
                  <ErrorMessage error={errors.websites} />
                </div>

                {/* Keywords */}
                <div className="mb-4">
                  <label className="block text-gray-700 text-sm font-bold mb-2">
                    Keywords (for search)
                  </label>
                  <div className="flex flex-wrap gap-2 mb-2 overflow-x-auto">
                    {keywords.map((keyword, index) => (
                      <span 
                        key={index} 
                        className="bg-gray-100 text-gray-800 px-2 py-1 rounded text-sm flex items-center"
                      >
                        <span className="whitespace-nowrap">
                          {keyword}
                        </span>
                        <button 
                          type="button" 
                          onClick={() => removeArrayItem(index, keywords, setKeywords)}
                          className="ml-2 text-gray-500 hover:text-gray-700"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex">
                    <input
                      type="text"
                      ref={keywordInputRef}
                      placeholder="Add keyword"
                      className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                      onKeyDown={(e) => handleArrayInput(e, keywords, setKeywords, keywordInputRef)}
                    />
                  </div>
                  <div className="text-xs text-gray-500 mt-1">Press Enter to add</div>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        {/* Form Actions - Fixed to bottom right, no border/shadow */}
        <div className="absolute bottom-6 right-6 flex space-x-3 bg-white py-2 px-1">
          <button
            type="button"
            onClick={handleCancel}
            className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline"
          >
            Save
          </button>
        </div>
      </form>
    </div>
  );
};

export default ListingForm;