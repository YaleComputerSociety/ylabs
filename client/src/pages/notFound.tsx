/**
 * 404 not found page.
 */
import { Link } from 'react-router-dom';
import useDocumentTitle from '../hooks/useDocumentTitle';

const NotFound = () => {
  useDocumentTitle('Page not found');
  return (
    <div className="yr-page flex min-h-[calc(100vh-8rem)] flex-col items-center justify-center px-4 py-14">
      <div className="yr-panel w-full max-w-3xl rounded-md p-6 sm:p-8">
        <div className="grid gap-8 md:grid-cols-[1.15fr_0.85fr] md:items-center">
          <div>
            <p className="yr-kicker mb-3">404</p>
            <h1 className="mb-4 text-3xl font-semibold leading-tight text-slate-950 sm:text-4xl">
              We couldn't find that Yale Research page
            </h1>
            <p className="text-slate-600">
              The link may be old, or the research profile may have moved. Start from a stable
              discovery surface and narrow back to the lab, program, faculty project, or pathway
              you wanted.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link
                to="/research"
                className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-[var(--yr-blue)] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
              >
                Explore Yale Research
              </Link>
              <Link
                to="/pathways"
                className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-800 transition-colors hover:border-blue-300 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
              >
                Browse Pathways
              </Link>
            </div>
          </div>

          <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Good next places
            </h2>
            <div className="mt-4 space-y-3">
              <Link
                to="/research"
                className="block rounded-md border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition-colors hover:border-blue-300 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
              >
                Research homes
              </Link>
              <Link
                to="/pathways"
                className="block rounded-md border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition-colors hover:border-blue-300 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
              >
                Evidence-backed next steps
              </Link>
              <Link
                to="/listings"
                className="block rounded-md border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition-colors hover:border-blue-300 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
              >
                Posted opportunities
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
