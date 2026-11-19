interface SearchSpellingNoticeProps {
  originalQuery: string;
  correctedQuery?: string;
  searchedLabel?: string;
  onSearchOriginal: () => void;
}

const SearchSpellingNotice = ({
  originalQuery,
  correctedQuery,
  searchedLabel = 'Showing results for',
  onSearchOriginal,
}: SearchSpellingNoticeProps) => (
  <p className="text-sm leading-relaxed text-muted">
    {correctedQuery ? (
      <>
        {searchedLabel} <strong className="font-semibold text-ink">{correctedQuery}</strong>.
      </>
    ) : (
      'Spelling corrected.'
    )}{' '}
    Search instead for{' '}
    <button
      type="button"
      onClick={onSearchOriginal}
      className="yr-focus-ring -my-1.5 mx-1 inline-block max-w-full rounded-control px-0.5 py-1.5 text-left font-medium text-brand underline underline-offset-2 hover:text-brand-navy"
    >
      {originalQuery}
    </button>
  </p>
);

export default SearchSpellingNotice;
