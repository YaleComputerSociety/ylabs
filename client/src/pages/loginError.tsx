/**
 * Login error page displayed on authentication failure.
 */
import { Link } from 'react-router-dom';

import SignInButton from '../components/SignInButton';
import useDocumentTitle from '../hooks/useDocumentTitle';

const LoginError = () => {
  useDocumentTitle('Sign in error');
  return (
    <div className="yr-page min-h-[calc(100vh-8rem)]">
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center px-5 py-14 text-center sm:px-8 sm:py-20">
        <div className="yr-panel rounded-md p-6">
          <p className="yr-kicker">Yale CAS</p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight text-slate-950 sm:text-4xl">
            We couldn't complete sign in
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-700 sm:text-lg">
            Yale Research did not receive a valid CAS session. Try Yale CAS again, or return to
            the research entry page and start from the surface you were opening.
          </p>
          <div className="mt-8 flex w-full max-w-md flex-col gap-3 sm:flex-row sm:justify-center">
            <SignInButton label="Try Yale CAS again" />
            <Link
              to="/"
              className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
            >
              Return to Yale Research
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginError;
