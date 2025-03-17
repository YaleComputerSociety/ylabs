import ErrorMessage from './ErrorMessage';

interface TextAreaProps {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    rows?: number;
    error?: string;
    onValidate?: (value: string) => void;
}

const TextArea = ({
    id,
    label,
    value,
    onChange,
    placeholder,
    rows = 10,
    error,
    onValidate
}: TextAreaProps) => {
    return (
        <div className="mb-4">
            <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="description">
                {label}
            </label>
            <textarea
                id={id}
                value={value}
                onChange={(e) => {
                    onChange(e.target.value);
                    if (onValidate) onValidate(e.target.value);
                }}
                placeholder={placeholder}
                className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline overflow-x-auto"
                rows={rows}
            />
            <ErrorMessage error={error} />
        </div>
    );
};

export default TextArea