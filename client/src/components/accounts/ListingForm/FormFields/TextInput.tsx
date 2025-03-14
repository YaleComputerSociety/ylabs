import ErrorMessage from './ErrorMessage';

interface TextInputProps {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    error?: string;
    onValidate?: (value: string) => void;
}

const TextInput = ({ 
    id, 
    label, 
    value, 
    onChange, 
    placeholder, 
    error, 
    onValidate 
}: TextInputProps) => {
    return (
        <div className="mb-4">
            <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor={id}>
                {label}
            </label>
            <input
                id={id}
                type="text"
                value={value}
                onChange={(e) => {
                    onChange(e.target.value);
                    if (onValidate) onValidate(e.target.value);
                }}
                placeholder={placeholder}
                className={`shadow appearance-none border ${error ? 'border-red-500' : ''} rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline whitespace-nowrap overflow-x-auto`}
            />
            <ErrorMessage error={error} />
        </div>
    );
};

export default TextInput;