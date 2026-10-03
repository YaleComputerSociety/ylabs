interface ResearchSearchDegradedNoticeProps {
  hasResults: boolean;
  onRetry: () => void;
  onBrowseAll?: () => void;
}

const actionClassName =
  'yr-focus-ring inline-flex min-h-11 items-center justify-center rounded-control border px-3 text-sm font-semibold transition-colors';

const retryClassName = `${actionClassName} border-brand bg-panel text-brand hover:bg-[var(--yr-panel-muted)]`;

const browseAllClassName = `${actionClassName} border-[var(--yr-line-strong)] text-ink-soft hover:bg-[var(--yr-panel-muted)]`;

const ResearchSearchDegradedNotice = ({
  hasResults,
  onRetry,
  onBrowseAll,
}: ResearchSearchDegradedNoticeProps) => (
  <section aria-label="Search is limited right now" className="yr-muted-surface rounded-card p-4">
    <p className="text-sm font-medium text-ink">Search is limited right now.</p>
    <p className="mt-1 text-sm leading-relaxed text-muted">
      {hasResults
        ? 'Full search is briefly unavailable, so some matching research may be missing and some cards may show less detail than usual. Try again in a few minutes.'
        : 'Full search is briefly unavailable, so an empty result here does not mean no research matches. Try again in a few minutes.'}
    </p>
    <div className="mt-4 flex flex-wrap gap-2">
      <button type="button" onClick={onRetry} className={retryClassName}>
        Try again
      </button>
      {!hasResults && onBrowseAll && (
        <button type="button" onClick={onBrowseAll} className={browseAllClassName}>
          Browse all research
        </button>
      )}
    </div>
  </section>
);

export default ResearchSearchDegradedNotice;
