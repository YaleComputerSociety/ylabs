/**
 * Labeled text input primitive with a11y-associated label/error.
 */
import React, { useId } from 'react';

interface TextFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  containerClassName?: string;
}

const TextField = React.forwardRef<HTMLInputElement, TextFieldProps>(
  ({ label, error, hint, required, id, containerClassName = '', className = '', ...rest }, ref) => {
    const reactId = useId();
    const inputId = id || reactId;
    const hintId = hint ? `${inputId}-hint` : undefined;
    const errorId = error ? `${inputId}-error` : undefined;
    const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

    return (
      <div className={containerClassName}>
        {label && (
          <label htmlFor={inputId} className="block text-xs font-medium text-gray-700 mb-1">
            {label}
            {required && <span className="text-red-500 ml-0.5" aria-hidden="true">*</span>}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          aria-required={required || undefined}
          className={`w-full border ${error ? 'border-red-400 focus:border-red-500 focus:ring-red-200' : 'border-gray-300 focus:border-blue-500 focus:ring-blue-200'} rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 ${className}`}
          {...rest}
        />
        {hint && !error && <p id={hintId} className="mt-1 text-xs text-gray-500">{hint}</p>}
        {error && <p id={errorId} className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
    );
  },
);

TextField.displayName = 'TextField';

export default TextField;
