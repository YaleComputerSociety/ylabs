import React, { useState, useRef } from 'react';
import axios from '../utils/axios';
import swal from 'sweetalert';

const Unknown = () => {
    // Form state
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [email, setEmail] = useState('');
    const [userType, setUserType] = useState('');
    const [isUserTypeDropdownOpen, setIsUserTypeDropdownOpen] = useState(false);
    const [focusedUserTypeIndex, setFocusedUserTypeIndex] = useState(-1);
    
    // Refs
    const userTypeRef = useRef<HTMLDivElement>(null);
    const userTypeInputRef = useRef<HTMLInputElement>(null);
    
    // Form errors
    const [errors, setErrors] = useState<{
        firstName?: string;
        lastName?: string;
        email?: string;
        userType?: string;
    }>({});

    // User type options
    const userTypeOptions = [
        { value: 'undergraduate', label: "Undergraduate Student" },
        { value: 'graduate', label: "Graduate Student" },
        { value: 'professor', label: "Professor" },
        { value: 'faculty', label: "Faculty" }
    ];

    // Validation functions
    const validateFirstName = (value: string): string | undefined => {
        return value.trim() ? undefined : "First name is required";
    };

    const validateLastName = (value: string): string | undefined => {
        return value.trim() ? undefined : "Last name is required";
    };

    const validateEmail = (value: string): string | undefined => {
        if (!value.trim()) {
            return "Email is required";
        }
        if (!value.includes('@') || !value.includes('.') || value.includes(' ')) {
            return "Invalid email format";
        }
        return undefined;
    };

    const validateUserType = (value: string): string | undefined => {
        return value.trim() ? undefined : "User type is required";
    };

    // Handle selecting a user type
    const handleUserTypeSelect = (value: string) => {
        setUserType(value);
        setIsUserTypeDropdownOpen(false);
        if (userTypeInputRef.current) {
            userTypeInputRef.current.blur();
        }
        setErrors(prev => ({ ...prev, userType: validateUserType(value) }));
    };

    // Handle keyboard navigation for user type dropdown
    const handleUserTypeInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        switch(e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setFocusedUserTypeIndex(prev =>
                    prev < userTypeOptions.length - 1 ? prev + 1 : prev
                );
                break;
            case 'ArrowUp':
                e.preventDefault();
                setFocusedUserTypeIndex(prev =>
                    prev > 0 ? prev - 1 : 0
                );
                break;
            case 'Enter':
                e.preventDefault();
                if (focusedUserTypeIndex >= 0 && focusedUserTypeIndex < userTypeOptions.length) {
                    handleUserTypeSelect(userTypeOptions[focusedUserTypeIndex].value);
                }
                break;
            case 'Escape':
                e.preventDefault();
                setIsUserTypeDropdownOpen(false);
                if (userTypeInputRef.current) {
                    userTypeInputRef.current.blur();
                }
                break;
            case 'Tab':
                setIsUserTypeDropdownOpen(false);
                break;
        }
    };

    // Handle form submission
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        
        // Validate all fields
        const validationErrors = {
            firstName: validateFirstName(firstName),
            lastName: validateLastName(lastName),
            email: validateEmail(email),
            userType: validateUserType(userType)
        };
        
        // Filter out undefined errors
        const filteredErrors = Object.fromEntries(
            Object.entries(validationErrors).filter(([_, value]) => value !== undefined)
        );
        
        // Update error state
        setErrors(filteredErrors);
        
        // Only proceed if no errors
        if (Object.keys(filteredErrors).length === 0) {
            console.log('Submitting user information:', { firstName, lastName, email, userType });

            axios.put('/users', {withCredentials: true, data: { fname: firstName, lname: lastName, email: email, userType: userType, userConfirmed: false}}).then((response) => {
                swal('Success!', 'Your information has been updated! You can now access the site. We will verify your information shortly.', 'success').then(() => {
                    window.location.href = "/";
                });
            }).catch((error) => {
                console.error('Failed to update user information:', error);
                swal('Error!', 'An error occurred while updating your information. Please try again.', 'error');
            });
        }
    };

    // Error message component
    const ErrorMessage = ({ error }: { error?: string }) => {
        return error ? (
            <p className="text-red-500 text-xs italic mt-1">{error}</p>
        ) : null;
    };

    return (
        <div className="fixed inset-0 flex items-center justify-center bg-gray-50 p-4">
            <div className="w-full max-w-md bg-white rounded-lg shadow-lg p-6">
                <div className="mb-6">
                    <h2 className="text-xl font-bold text-gray-800 mb-2">Welcome to y/labs!</h2>
                    <div className="bg-amber-100 border-l-4 border-amber-500 text-amber-700 p-4 rounded">
                        <div className="flex items-center">
                            <svg className="h-6 w-6 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            <p>We couldn't find your information. Please complete the form below to continue.</p>
                        </div>
                    </div>
                </div>

                <form onSubmit={handleSubmit}>
                    {/* First Name */}
                    <div className="mb-4">
                        <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="firstName">
                            First Name
                        </label>
                        <input
                            id="firstName"
                            type="text"
                            value={firstName}
                            onChange={(e) => {
                                setFirstName(e.target.value);
                                if (errors.firstName) {
                                    setErrors(prev => ({ ...prev, firstName: validateFirstName(e.target.value) }));
                                }
                            }}
                            className={`shadow appearance-none border ${errors.firstName ? 'border-red-500' : ''} rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500`}
                        />
                        <ErrorMessage error={errors.firstName} />
                    </div>

                    {/* Last Name */}
                    <div className="mb-4">
                        <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="lastName">
                            Last Name
                        </label>
                        <input
                            id="lastName"
                            type="text"
                            value={lastName}
                            onChange={(e) => {
                                setLastName(e.target.value);
                                if (errors.lastName) {
                                    setErrors(prev => ({ ...prev, lastName: validateLastName(e.target.value) }));
                                }
                            }}
                            className={`shadow appearance-none border ${errors.lastName ? 'border-red-500' : ''} rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500`}
                        />
                        <ErrorMessage error={errors.lastName} />
                    </div>

                    {/* Email */}
                    <div className="mb-4">
                        <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="email">
                            Email
                        </label>
                        <input
                            id="email"
                            type="text"
                            value={email}
                            onChange={(e) => {
                                setEmail(e.target.value);
                                if (errors.email) {
                                    setErrors(prev => ({ ...prev, email: validateEmail(e.target.value) }));
                                }
                            }}
                            className={`shadow appearance-none border ${errors.email ? 'border-red-500' : ''} rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500`}
                        />
                        <ErrorMessage error={errors.email} />
                    </div>

                    {/* User Type */}
                    <div className="mb-6" ref={userTypeRef}>
                        <label className="block text-gray-700 text-sm font-bold mb-2">
                            User Type
                        </label>
                        <div className="relative">
                            <div className="relative">
                                <input
                                    ref={userTypeInputRef}
                                    id="userType"
                                    type="text"
                                    readOnly
                                    value={userType ? userTypeOptions.find(option => option.value === userType)?.label || "" : ""}
                                    onClick={() => {
                                        setIsUserTypeDropdownOpen(true);
                                    }}
                                    onKeyDown={handleUserTypeInputKeyDown}
                                    onFocus={() => setIsUserTypeDropdownOpen(true)}
                                    onBlur={() => {
                                        setTimeout(() => {
                                            if (!userTypeRef.current?.contains(document.activeElement)) {
                                                setIsUserTypeDropdownOpen(false);
                                            }
                                        }, 100);
                                    }}
                                    className={`shadow appearance-none border ${errors.userType ? 'border-red-500' : ''} rounded w-full py-2 px-3 pr-10 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer`}
                                />
                                <div
                                    className="absolute inset-y-0 right-0 flex items-center px-2 text-gray-700 cursor-pointer"
                                    onClick={() => {
                                        setIsUserTypeDropdownOpen(!isUserTypeDropdownOpen);
                                        if (!isUserTypeDropdownOpen && userTypeInputRef.current) {
                                            userTypeInputRef.current.focus();
                                        }
                                    }}
                                >
                                    <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                                        <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
                                    </svg>
                                </div>
                            </div>

                            {/* User Type Dropdown */}
                            {isUserTypeDropdownOpen && (
                                <div
                                    className="absolute left-0 right-0 bg-white rounded-lg z-10 shadow-lg border overflow-hidden mt-1 max-h-[200px] border-gray-300"
                                    tabIndex={-1}
                                >
                                    <ul className="max-h-[200px] overflow-y-auto" tabIndex={-1}>
                                        {userTypeOptions.map((option, index) => (
                                            <li
                                                key={index}
                                                onClick={() => handleUserTypeSelect(option.value)}
                                                className={`p-2 cursor-pointer flex items-center justify-between ${
                                                    focusedUserTypeIndex === index ? 'bg-blue-100' : 'hover:bg-gray-100'
                                                }`}
                                                tabIndex={-1}
                                                onMouseDown={(e) => e.preventDefault()}
                                            >
                                                <span>{option.label}</span>
                                                {userType === option.value && (
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
                        <ErrorMessage error={errors.userType} />
                    </div>

                    {/* Submit Button */}
                    <div className="flex justify-end">
                        <button
                            type="submit"
                            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded focus:outline-none focus:shadow-outline"
                        >
                            Continue
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default Unknown;