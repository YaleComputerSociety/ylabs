import { CloseIcon } from './icons';

export const SEARCH_INPUT_NATIVE_CANCEL_HIDDEN = '[&::-webkit-search-cancel-button]:hidden';

export const SEARCH_INPUT_CLEAR_BUTTON_PADDING = 'pr-12';

interface SearchClearButtonProps {
  onClear: () => void;
}

const SearchClearButton = ({ onClear }: SearchClearButtonProps) => (
  <button
    type="button"
    aria-label="Clear search"
    onClick={onClear}
    className="yr-focus-ring yr-pressable absolute right-1 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-control text-muted hover:text-ink"
  >
    <CloseIcon size={18} />
  </button>
);

export default SearchClearButton;
