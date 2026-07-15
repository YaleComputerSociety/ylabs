/** Accessible account setup for authenticated users whose Yale role is unknown. */
import React, { useReducer, useRef } from 'react';
import axios from '../utils/axios';
import {
  createInitialUnknownUserState,
  unknownUserReducer,
  UnknownUserErrors,
} from '../reducers/unknownUserReducer';
import useDocumentTitle from '../hooks/useDocumentTitle';

const USER_TYPES = [
  { value: 'undergraduate', label: 'Undergraduate Student' },
  { value: 'graduate', label: 'Graduate Student' },
  { value: 'professor', label: 'Professor' },
  { value: 'faculty', label: 'Faculty' },
] as const;

type FieldName = keyof UnknownUserErrors;

const Unknown = () => {
  useDocumentTitle('Set up account');
  const [state, dispatch] = useReducer(unknownUserReducer, undefined, () =>
    createInitialUnknownUserState(),
  );
  const { firstName, lastName, email, userType, errors, submissionStatus, submissionError } = state;
  const fieldRefs = {
    firstName: useRef<HTMLInputElement>(null),
    lastName: useRef<HTMLInputElement>(null),
    email: useRef<HTMLInputElement>(null),
    userType: useRef<HTMLSelectElement>(null),
  };

  const validate = (): UnknownUserErrors => ({
    ...(!firstName.trim() ? { firstName: 'First name is required' } : {}),
    ...(!lastName.trim() ? { lastName: 'Last name is required' } : {}),
    ...(!email.trim()
      ? { email: 'Email is required' }
      : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        ? { email: 'Enter a valid email address' }
        : {}),
    ...(!userType ? { userType: 'Role at Yale is required' } : {}),
  });

  const clearFieldError = (field: FieldName) => {
    if (!errors[field]) return;
    dispatch({
      type: 'SET_ERRORS',
      payload: (previous) => ({ ...previous, [field]: undefined }),
    });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submissionStatus === 'submitting') return;

    const validationErrors = validate();
    dispatch({ type: 'SET_ERRORS', payload: validationErrors });
    const firstInvalidField = (['firstName', 'lastName', 'email', 'userType'] as FieldName[]).find(
      (field) => validationErrors[field],
    );
    if (firstInvalidField) {
      requestAnimationFrame(() => fieldRefs[firstInvalidField].current?.focus());
      return;
    }

    dispatch({ type: 'SUBMIT_START' });
    try {
      const response = await axios.put('/users', {
        withCredentials: true,
        data: {
          fname: firstName.trim(),
          lname: lastName.trim(),
          email: email.trim(),
          userType,
          userConfirmed: false,
        },
      });
      const persistedUser = response.data?.user;
      if (
        !persistedUser ||
        persistedUser.fname !== firstName.trim() ||
        persistedUser.lname !== lastName.trim() ||
        persistedUser.userType !== userType
      ) {
        throw new Error('The saved account response did not match the submitted account.');
      }
      dispatch({ type: 'SUBMIT_SUCCESS' });
    } catch {
      dispatch({
        type: 'SUBMIT_ERROR',
        payload:
          'We could not save your account setup. Your information was not confirmed. Try again.',
      });
    }
  };

  if (submissionStatus === 'success') {
    return (
      <main className="yr-page flex min-h-full items-center justify-center p-4">
        <section
          className="yr-panel w-full max-w-md rounded-md p-6"
          aria-labelledby="setup-complete"
          aria-live="polite"
          role="status"
        >
          <p className="yr-kicker">Account setup saved</p>
          <h1
            id="setup-complete"
            className="mt-1 text-2xl font-semibold text-slate-950"
            tabIndex={-1}
          >
            Your account setup is complete
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            Your information was saved. You can now continue to Yale Research while your account
            details remain subject to the existing verification process.
          </p>
          <a
            href="/"
            className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-md bg-[var(--yr-blue)] px-6 py-2 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-blue-200"
          >
            Continue to Yale Research
          </a>
        </section>
      </main>
    );
  }

  const ErrorMessage = ({ field }: { field: FieldName }) =>
    errors[field] ? (
      <p id={`${field}-error`} className="mt-1 text-xs text-red-700">
        {errors[field]}
      </p>
    ) : null;
  const errorFields = (Object.keys(errors) as FieldName[]).filter((field) => errors[field]);
  const inputClass = (field: FieldName) =>
    `min-h-[44px] w-full rounded-md border bg-[var(--yr-panel)] px-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
      errors[field] ? 'border-red-500' : 'border-[var(--yr-line-strong)]'
    }`;

  return (
    <main className="yr-page flex min-h-full items-center justify-center p-4">
      <section className="yr-panel w-full max-w-md rounded-md p-6" aria-labelledby="setup-heading">
        <div className="mb-6">
          <p className="yr-kicker">One-minute setup</p>
          <h1 id="setup-heading" className="mt-1 text-2xl font-semibold text-slate-950">
            Tell us how you use Yale Research
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            This keeps the app pointed at the right research planning experience. You can start
            searching after your information is saved.
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate aria-busy={submissionStatus === 'submitting'}>
          {errorFields.length > 0 && (
            <div
              role="alert"
              aria-labelledby="setup-errors-heading"
              className="mb-5 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900"
            >
              <p id="setup-errors-heading" className="font-semibold">
                Check {errorFields.length === 1 ? 'this field' : 'the highlighted fields'}
              </p>
              <ul className="mt-1 list-disc pl-5">
                {errorFields.map((field) => (
                  <li key={field}>{errors[field]}</li>
                ))}
              </ul>
            </div>
          )}
          {submissionError && (
            <p
              role="alert"
              className="mb-5 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900"
            >
              {submissionError}
            </p>
          )}

          <div className="mb-4">
            <label className="mb-2 block text-sm font-semibold text-slate-900" htmlFor="firstName">
              First name
            </label>
            <input
              ref={fieldRefs.firstName}
              id="firstName"
              name="firstName"
              autoComplete="given-name"
              value={firstName}
              aria-invalid={Boolean(errors.firstName)}
              aria-describedby={errors.firstName ? 'firstName-error' : undefined}
              onChange={(event) => {
                dispatch({ type: 'SET_FIRST_NAME', payload: event.target.value });
                clearFieldError('firstName');
              }}
              className={inputClass('firstName')}
            />
            <ErrorMessage field="firstName" />
          </div>
          <div className="mb-4">
            <label className="mb-2 block text-sm font-semibold text-slate-900" htmlFor="lastName">
              Last name
            </label>
            <input
              ref={fieldRefs.lastName}
              id="lastName"
              name="lastName"
              autoComplete="family-name"
              value={lastName}
              aria-invalid={Boolean(errors.lastName)}
              aria-describedby={errors.lastName ? 'lastName-error' : undefined}
              onChange={(event) => {
                dispatch({ type: 'SET_LAST_NAME', payload: event.target.value });
                clearFieldError('lastName');
              }}
              className={inputClass('lastName')}
            />
            <ErrorMessage field="lastName" />
          </div>
          <div className="mb-4">
            <label className="mb-2 block text-sm font-semibold text-slate-900" htmlFor="email">
              Email
            </label>
            <input
              ref={fieldRefs.email}
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? 'email-error' : undefined}
              onChange={(event) => {
                dispatch({ type: 'SET_EMAIL', payload: event.target.value });
                clearFieldError('email');
              }}
              className={inputClass('email')}
            />
            <ErrorMessage field="email" />
          </div>
          <div className="mb-6">
            <label className="mb-2 block text-sm font-semibold text-slate-900" htmlFor="userType">
              Role at Yale
            </label>
            <select
              ref={fieldRefs.userType}
              id="userType"
              name="userType"
              value={userType}
              aria-invalid={Boolean(errors.userType)}
              aria-describedby={errors.userType ? 'userType-error' : undefined}
              onChange={(event) => {
                dispatch({ type: 'SET_USER_TYPE', payload: event.target.value });
                clearFieldError('userType');
              }}
              className={inputClass('userType')}
            >
              <option value="">Select your role</option>
              {USER_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <ErrorMessage field="userType" />
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submissionStatus === 'submitting'}
              className="inline-flex min-h-[44px] w-full items-center justify-center rounded-md bg-[var(--yr-blue)] px-6 py-2 text-sm font-semibold text-white hover:bg-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-wait disabled:opacity-70 sm:w-auto"
            >
              {submissionStatus === 'submitting' ? 'Saving account setup...' : 'Save and continue'}
            </button>
          </div>
          <p className="sr-only" aria-live="polite">
            {submissionStatus === 'submitting' ? 'Saving account setup.' : ''}
          </p>
        </form>
      </section>
    </main>
  );
};

export default Unknown;
