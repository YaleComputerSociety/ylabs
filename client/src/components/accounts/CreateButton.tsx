interface CreateButtonProps {
    globalEditing: boolean;
    handleCreate: () => void;
}

const CreateButton = ({ globalEditing, handleCreate }: CreateButtonProps) => {
    return (
        <button
            className={`py-1 px-2 rounded-md ${globalEditing 
                ? "text-gray-400 cursor-not-allowed" 
                : "hover:bg-gray-100 text-green-500 hover:text-green-700 transition-colors"
            }`}
            onClick={(e) => {
                e.stopPropagation();
                if (!globalEditing) {
                    handleCreate();
                }
            }}
            title={globalEditing ? "Must close current editor" : "Create listing"}
            aria-label={globalEditing ? "Create listing disabled" : "Edit listing"}
            disabled={globalEditing}
        >
            <div className='flex items-center justify-center'>
                <span className='mr-1 text-md font-semibold'>Create Listing</span>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
            </div>
        </button>
    );
};

export default CreateButton;