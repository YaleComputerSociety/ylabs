/**
 * Fallback page for unknown user types.
 */
import React, { useReducer, useRef } from 'react';
import axios from '../utils/axios';
import swal from 'sweetalert';
import {
  createInitialUnknownUserState,
  unknownUserReducer,
  UnknownUserErrors,
} from '../reducers/unknownUserReducer';
import useDocumentTitle from '../hooks/useDocumentTitle';

const Unknown = () => {
  useDocumentTitle('Set up account');
  const [state, dispatch] = useReducer(unknownUserReducer, undefined, () =>
    createInitialUnknownUserState(),
  );
  const { firstName, lastName, email, userType, isUserTypeDropdownOpen, focusedUserTypeIndex, errors } =
    state;

  const userTypeRef = useRef<HTMLDivElement>(null);
  const userTypeInputRef = useRef<HTMLInputElement>(null);

  const userTypeOptions = [
    { value: 'undergraduate', label: 'Undergraduate Student' },
    { value: 'graduate', label: 'Graduate Student' },
    { value: 'professor', label: 'Professor' },
    { value: 'faculty', label: 'Faculty' },
  ];

  const validateFirstName = (value: string): string | undefined => {
    return value.trim() ? undefined : 'First name is required';
  };

  const validateLastName = (value: string): string | undefined => {
    return value.trim() ? undefined : 'Last name is required';
  };

  const validateEmail = (value: string): string | undefined => {
    if (!value.trim()) {
      return 'Email is required';
    }
    if (!value.includes('@') || !value.includes('.') || value.includes(' ')) {
      return 'Invalid email format';
    }
    return undefined;
  };

  const validateUserType = (value: string): string | undefined => {
    return value.trim() ? undefined : 'Role at Yale is required';
  };

  const handleUserTypeSelect = (value: string) => {
    dispatch({ type: 'SELECT_USER_TYPE', payload: value });
    if (userTypeInputRef.current) {
      userTypeInputRef.current.blur();
    }
    dispatch({
      type: 'SET_ERRORS',
      payload: (prev) => ({ ...prev, userType: validateUserType(value) }),
    });
  };

  const handleUserTypeInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        dispatch({
          type: 'SET_FOCUSED_INDEX',
          payload: (prev) => (prev < userTypeOptions.length - 1 ? prev + 1 : prev),
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
        if (focusedUserTypeIndex >= 0 && focusedUserTypeIndex < userTypeOptions.length) {
          handleUserTypeSelect(userTypeOptions[focusedUserTypeIndex].value);
        }
        break;
      case 'Escape':
        e.preventDefault();
        dispatch({ type: 'CLOSE_DROPDOWN' });
        if (userTypeInputRef.current) {
          userTypeInputRef.current.blur();
        }
        break;
      case 'Tab':
        dispatch({ type: 'CLOSE_DROPDOWN' });
        break;
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const validationErrors = {
      firstName: validateFirstName(firstName),
      lastName: validateLastName(lastName),
      email: validateEmail(email),
      userType: validateUserType(userType),
    };

    const filteredErrors: UnknownUserErrors = Object.fromEntries(
      Object.entries(validationErrors).filter(([_, value]) => value !== undefined),
    );

    dispatch({ type: 'SET_ERRORS', payload: filteredErrors });

    if (Object.keys(filteredErrors).length === 0) {
      axios
        .put('/users', {
          withCredentials: true,
          data: {
            fname: firstName,
            lname: lastName,
            email: email,
            userType: userType,
            userConfirmed: false,
          },
        })
        .then((_response) => {
          swal(
            'Success!',
            'Your information has been updated! You can now access the site. We will verify your information shortly.',
            'success',
          ).then(() => {
            window.location.href = '/';
          });
        })
        .catch(() => {
          console.error('Failed to update user information.');
          swal(
            'Error!',
            'An error occurred while updating your information. Please try again.',
            'error',
          );
        });
    }
  };

  const ErrorMessage = ({ error }: { error?: string }) => {
    return error ? <p className="text-red-500 text-xs italic mt-1">{error}</p> : null;
  };

  return (
    <div className="yr-page flex min-h-full items-center justify-center p-4">
      <div className="yr-panel w-full max-w-md rounded-md p-6">
        <div className="mb-6">
          <p className="yr-kicker">
            One-minute setup
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950">
            Tell us how you use Yale Research
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            This keeps the app pointed at the right research planning experience. You can start
            searching as soon as this is saved.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="mb-2 block text-sm font-semibold text-slate-900" htmlFor="firstName">
              First name
            </label>
            <input
              id="firstName"
              type="text"
              value={firstName}
              onChange={(e) => {
                dispatch({ type: 'SET_FIRST_NAME', payload: e.target.value });
                if (errors.firstName) {
                  dispatch({
                    type: 'SET_ERRORS',
                    payload: (prev) => ({ ...prev, firstName: validateFirstName(e.target.value) }),
                  });
                }
              }}
              className={`min-h-[44px] w-full rounded-md border bg-[var(--yr-panel)] px-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.firstName ? 'border-red-500' : 'border-[var(--yr-line-strong)]'}`}
            />
            <ErrorMessage error={errors.firstName} />
          </div>

          <div className="mb-4">
            <label className="mb-2 block text-sm font-semibold text-slate-900" htmlFor="lastName">
              Last name
            </label>
            <input
              id="lastName"
              type="text"
              value={lastName}
              onChange={(e) => {
                dispatch({ type: 'SET_LAST_NAME', payload: e.target.value });
                if (errors.lastName) {
                  dispatch({
                    type: 'SET_ERRORS',
                    payload: (prev) => ({ ...prev, lastName: validateLastName(e.target.value) }),
                  });
                }
              }}
              className={`min-h-[44px] w-full rounded-md border bg-[var(--yr-panel)] px-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.lastName ? 'border-red-500' : 'border-[var(--yr-line-strong)]'}`}
            />
            <ErrorMessage error={errors.lastName} />
          </div>

          <div className="mb-4">
            <label className="mb-2 block text-sm font-semibold text-slate-900" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="text"
              value={email}
              onChange={(e) => {
                dispatch({ type: 'SET_EMAIL', payload: e.target.value });
                if (errors.email) {
                  dispatch({
                    type: 'SET_ERRORS',
                    payload: (prev) => ({ ...prev, email: validateEmail(e.target.value) }),
                  });
                }
              }}
              className={`min-h-[44px] w-full rounded-md border bg-[var(--yr-panel)] px-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.email ? 'border-red-500' : 'border-[var(--yr-line-strong)]'}`}
            />
            <ErrorMessage error={errors.email} />
          </div>

          <div className="mb-6" ref={userTypeRef}>
            <label className="mb-2 block text-sm font-semibold text-slate-900" htmlFor="userType">
              Role at Yale
            </label>
            <div className="relative">
              <div className="relative">
                <input
                  ref={userTypeInputRef}
                  id="userType"
                  type="text"
                  readOnly
                  value={
                    userType
                      ? userTypeOptions.find((option) => option.value === userType)?.label || ''
                      : ''
                  }
                  onClick={() => {
                    dispatch({ type: 'OPEN_DROPDOWN' });
                  }}
                  onKeyDown={handleUserTypeInputKeyDown}
                  onFocus={() => dispatch({ type: 'OPEN_DROPDOWN' })}
                  onBlur={() => {
                    setTimeout(() => {
                      if (!userTypeRef.current?.contains(document.activeElement)) {
                        dispatch({ type: 'CLOSE_DROPDOWN' });
                      }
                    }, 100);
                  }}
                  className={`min-h-[44px] w-full cursor-pointer rounded-md border bg-[var(--yr-panel)] px-3 pr-10 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.userType ? 'border-red-500' : 'border-[var(--yr-line-strong)]'}`}
                />
                <button
                  type="button"
                  aria-label={isUserTypeDropdownOpen ? 'Close role options' : 'Open role options'}
                  className="absolute inset-y-0 right-0 inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-r-md text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  onClick={() => {
                    if (isUserTypeDropdownOpen) {
                      dispatch({ type: 'CLOSE_DROPDOWN' });
                    } else {
                      dispatch({ type: 'OPEN_DROPDOWN' });
                      if (userTypeInputRef.current) {
                        userTypeInputRef.current.focus();
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
                </button>
              </div>

              {isUserTypeDropdownOpen && (
                <div
                  className="mt-2 max-h-[200px] overflow-hidden rounded-md border border-[var(--yr-line-strong)] bg-[var(--yr-panel)] shadow-lg"
                  role="listbox"
                  aria-label="Role at Yale options"
                  tabIndex={-1}
                >
                  <ul className="max-h-[200px] overflow-y-auto" tabIndex={-1}>
                    {userTypeOptions.map((option, index) => (
                      <li
                        key={index}
                        role="option"
                        aria-selected={userType === option.value}
                        onClick={() => handleUserTypeSelect(option.value)}
                        className={`flex min-h-[44px] cursor-pointer items-center justify-between p-2 ${
                          focusedUserTypeIndex === index ? 'bg-[var(--yr-blue-soft)]' : 'hover:bg-[var(--yr-panel-muted)]'
                        }`}
                        tabIndex={-1}
                        onMouseDown={(e) => e.preventDefault()}
                      >
                        <span>{option.label}</span>
                        {userType === option.value && (
                          <svg
                            className="h-4 w-4 text-blue-500"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2"
                              d="M5 13l4 4L19 7"
                            ></path>
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

          <div className="flex justify-end">
            <button
              type="submit"
              className="inline-flex min-h-[44px] w-full items-center justify-center rounded-md bg-[var(--yr-blue)] px-6 py-2 text-sm font-semibold text-white hover:bg-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-200 sm:w-auto"
            >
              Continue to Yale Research
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default Unknown;
