/**
 * Labeled select primitive.
 */
import React, { useId } from 'react';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  label?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  options: SelectOption[];
  placeholder?: string;
  containerClassName?: string;
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, hint, required, options, placeholder, id, containerClassName = '', className = '', ...rest }, ref) => {
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
        <select
          ref={ref}
          id={inputId}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          aria-required={required || undefined}
          className={`w-full border ${error ? 'border-red-400 focus:border-red-500 focus:ring-red-200' : 'border-gray-300 focus:border-blue-500 focus:ring-blue-200'} rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 bg-white ${className}`}
          {...rest}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {hint && !error && <p id={hintId} className="mt-1 text-xs text-gray-500">{hint}</p>}
        {error && <p id={errorId} className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
    );
  },
);

Select.displayName = 'Select';

export default Select;
