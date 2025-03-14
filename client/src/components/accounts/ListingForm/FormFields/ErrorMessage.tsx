const ErrorMessage = ({ error }: { error?: string }) => {
    if (!error) return null;
    return <div className="text-red-500 text-xs mt-1">{error}</div>;
};

export default ErrorMessage