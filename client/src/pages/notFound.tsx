/**
 * 404 not found page.
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import useDocumentTitle from '../hooks/useDocumentTitle';

const NotFound = ({ suggestedQuery = '' }: { suggestedQuery?: string }) => {
  useDocumentTitle('Page not found');
  const navigate = useNavigate();
  const [query, setQuery] = useState(suggestedQuery);
  const trimmedQuery = query.trim();

  const searchResearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void navigate(trimmedQuery ? `/research?q=${encodeURIComponent(trimmedQuery)}` : '/research');
  };

  return (
    <div className="yr-page flex min-h-[calc(100vh-8rem)] flex-col items-center justify-center px-4 py-14">
      <div className="yr-panel w-full max-w-md rounded-card p-6 text-center">
        <p className="yr-kicker mb-3">404</p>
        <h1 className="yr-display mb-4 text-3xl font-semibold leading-tight text-ink sm:text-4xl sm:leading-10">
          We couldn't find that y/labs page
        </h1>
        <p className="mb-6 text-muted">
          The link may be old, or the research profile may have moved.
          {suggestedQuery
            ? ' Search for it by name or topic:'
            : ' Search for a lab, faculty research, or topic:'}
        </p>
        <form role="search" onSubmit={searchResearch} className="flex flex-col gap-2 text-left">
          <label htmlFor="not-found-search" className="text-sm font-semibold text-ink">
            Search y/labs
          </label>
          <input
            id="not-found-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Try a topic, professor, or lab"
            className="yr-focus-ring min-h-12 w-full rounded-control border border-[var(--yr-line-control)] bg-[var(--yr-panel)] px-4 text-base text-ink placeholder:text-muted focus:border-[var(--yr-blue)]"
          />
          <button
            type="submit"
            className="yr-pressable mt-1 inline-flex min-h-[44px] items-center justify-center rounded-control bg-[var(--yr-blue)] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-navy yr-focus-ring"
          >
            Search
          </button>
        </form>
        <Link
          to="/research"
          className="yr-link yr-focus-ring mt-4 inline-flex min-h-11 items-center rounded-control px-1 text-sm font-semibold"
        >
          Explore research
        </Link>
      </div>
    </div>
  );
};

export default NotFound;
