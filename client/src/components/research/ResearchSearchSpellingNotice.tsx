interface ResearchSearchSpellingNoticeProps {
  originalQuery: string;
  onSearchOriginal: () => void;
}

const ResearchSearchSpellingNotice = ({
  originalQuery,
  onSearchOriginal,
}: ResearchSearchSpellingNoticeProps) => (
  <p className="text-sm leading-relaxed text-muted">
    Spelling corrected. Search instead for{' '}
    <button
      type="button"
      onClick={onSearchOriginal}
      className="yr-focus-ring ml-0.5 rounded-control px-0.5 font-medium text-brand underline underline-offset-2 hover:text-brand-navy"
    >
      {originalQuery}
    </button>
  </p>
);

export default ResearchSearchSpellingNotice;
