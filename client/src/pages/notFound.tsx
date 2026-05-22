/**
 * 404 not found page.
 */
import { Link } from 'react-router-dom';
import useDocumentTitle from '../hooks/useDocumentTitle';

const NotFound = () => {
  useDocumentTitle('Page not found');
  return (
    <div className="yr-page flex min-h-[calc(100vh-8rem)] flex-col items-center justify-center px-4 py-14">
      <div className="yr-panel max-w-md rounded-md p-6 text-center">
        <p className="yr-kicker mb-3">404</p>
        <h1 className="mb-4 text-3xl font-semibold leading-tight text-slate-950 sm:text-4xl">
          We couldn't find that Yale Research page
        </h1>
        <p className="mb-8 text-slate-600">
          The link may be old, or the research profile may have moved. Explore Research is the
          best place to search for a lab, program, faculty project, or pathway again.
        </p>
        <Link
          to="/research"
          className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-[var(--yr-blue)] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
        >
          Explore Yale Research
        </Link>
      </div>
    </div>
  );
};

export default NotFound;
