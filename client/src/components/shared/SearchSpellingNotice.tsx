interface SearchSpellingNoticeProps {
  originalQuery: string;
  correctedQuery?: string;
  onSearchOriginal: () => void;
}

const SearchSpellingNotice = ({
  originalQuery,
  correctedQuery,
  onSearchOriginal,
}: SearchSpellingNoticeProps) => (
  <p className="text-sm leading-relaxed text-muted">
    {correctedQuery ? (
      <>
        Showing results for <strong className="font-semibold text-ink">{correctedQuery}</strong>.
      </>
    ) : (
      'Spelling corrected.'
    )}{' '}
    Search instead for{' '}
    <button
      type="button"
      onClick={onSearchOriginal}
      className="yr-focus-ring rounded-control px-0.5 font-medium text-brand underline underline-offset-2 hover:text-brand-navy"
    >
      {originalQuery}
    </button>
  </p>
);

export default SearchSpellingNotice;
