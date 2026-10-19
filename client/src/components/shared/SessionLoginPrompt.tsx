import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { announcePageLoginPrompt } from '../../utils/httpStatusEvents';

const SessionLoginPrompt = ({ subject }: { subject: string }) => {
  const location = useLocation();

  useEffect(() => {
    announcePageLoginPrompt(true);
    return () => announcePageLoginPrompt(false);
  }, []);

  return (
    <div className="yr-page flex min-h-[calc(100vh-8rem)] flex-col items-center justify-center px-4 py-14">
      <div className="yr-panel max-w-md rounded-card p-6 text-center">
        <h1 className="yr-display mb-4 text-2xl font-semibold leading-tight text-ink">
          Your session needs a fresh login
        </h1>
        <p className="mb-8 text-muted">Log in with Yale again to see {subject}.</p>
        <Link
          to="/login"
          state={{ from: `${location.pathname}${location.search}` }}
          className="yr-pressable inline-flex min-h-[44px] items-center justify-center rounded-control bg-[var(--yr-blue)] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-navy yr-focus-ring"
        >
          Log in with Yale
        </Link>
      </div>
    </div>
  );
};

export default SessionLoginPrompt;
