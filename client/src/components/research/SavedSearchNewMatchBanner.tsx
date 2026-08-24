import { Link } from 'react-router-dom';

import { useSavedSearchNewMatchCount } from '../../hooks/useSavedSearchNewMatchCount';

interface SavedSearchNewMatchBannerProps {
  enabled: boolean;
}

const newMatchSummary = (count: number): string =>
  `${count} new ${count === 1 ? 'match' : 'matches'} for your saved searches`;

const SavedSearchNewMatchBanner = ({ enabled }: SavedSearchNewMatchBannerProps) => {
  const newMatchCount = useSavedSearchNewMatchCount({ enabled });

  if (!enabled || newMatchCount === 0) return null;

  return (
    <div
      role="status"
      className="mb-4 flex items-center justify-between gap-3 rounded-md border border-blue-100 bg-[var(--yr-blue-soft)] px-4 py-3"
    >
      <p className="text-sm font-semibold text-blue-900">{newMatchSummary(newMatchCount)}</p>
      <Link
        to="/account"
        state={{ surface: 'searches' }}
        aria-label={`${newMatchSummary(newMatchCount)}. View your saved searches.`}
        className="shrink-0 rounded-md bg-[var(--yr-blue)] px-3 py-2 text-sm font-semibold text-white hover:bg-brand-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
      >
        View saved searches
      </Link>
    </div>
  );
};

export default SavedSearchNewMatchBanner;
