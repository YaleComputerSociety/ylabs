/**
 * Login page with Yale CAS authentication redirect.
 */
import PulseLoader from 'react-spinners/PulseLoader';
import { useContext } from 'react';

import SignInButton from '../components/SignInButton';
import UserContext from '../contexts/UserContext';
import { Navigate, useLocation } from 'react-router-dom';
import useDocumentTitle from '../hooks/useDocumentTitle';

const Login = () => {
  const { isLoading, isAuthenticated, user } = useContext(UserContext);
  useDocumentTitle('Sign in');
  const location = useLocation();
  const locationState = location.state as { from?: string } | null;
  const returnPath = locationState?.from || '';
  const destination = (() => {
    if (returnPath.startsWith('/research') || returnPath.startsWith('/listings')) {
      return {
        heading: 'Continue to Yale Research',
        description: 'Use your Yale account to browse research homes, evidence, and source-backed profiles.',
      };
    }
    if (returnPath.startsWith('/pathways')) {
      return {
        heading: 'Continue to Yale Research',
        description: 'Use your Yale account to browse labs, evidence, and possible ways in.',
      };
    }
    if (returnPath.startsWith('/programs') || returnPath.startsWith('/fellowships')) {
      return {
        heading: 'Continue to Programs & Fellowships',
        description: 'Use your Yale account to review structured programs, funding cycles, and planning context.',
      };
    }
    if (returnPath.startsWith('/opportunities')) {
      return {
        heading: 'Continue to Opportunity Details',
        description: 'Use your Yale account to review the evidence, deadline, and application next step.',
      };
    }
    if (returnPath.startsWith('/profile')) {
      return {
        heading: 'Continue to Profile',
        description: 'Use your Yale account to view research interests, activity, and Yale Research context.',
      };
    }
    if (returnPath.startsWith('/account')) {
      return {
        heading: 'Continue to Your Account',
        description: 'Use your Yale account to manage saved research plans, profile details, and program planning.',
      };
    }
    if (returnPath.startsWith('/about')) {
      return {
        heading: 'Continue to About Yale Research',
        description: 'Use your Yale account to learn how Yale Research is built and supported.',
      };
    }
    return {
      heading: 'Continue to Yale Research',
      description: 'Use your Yale account to open the research discovery workspace.',
    };
  })();

  const getRedirectPath = () => {
    if (user?.userType === 'professor') {
      return '/account';
    }
    return '/';
  };

  return (
    <div className="yr-page min-h-[calc(100vh-8rem)]">
      <div className="mx-auto grid w-full max-w-6xl items-start gap-8 px-5 py-8 sm:px-8 sm:py-14 lg:grid-cols-[minmax(0,1fr)_390px] lg:pt-24">
        <section className="mx-auto max-w-2xl text-center lg:mx-0 lg:text-left">
          <div className="flex items-center justify-center gap-3 lg:justify-start">
            <img
              src="/brand/yale-research-mark.svg"
              alt=""
              className="h-14 w-14 drop-shadow-sm sm:h-16 sm:w-16"
            />
            <span className="yr-wordmark text-4xl text-[var(--yr-blue)] sm:text-5xl">
              Yale Research
            </span>
          </div>
          <p className="yr-kicker mt-8">Source-backed discovery</p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight text-slate-950 sm:text-5xl">
            Find a credible path into Yale research
          </h1>
          <p className="mt-4 text-base leading-relaxed text-slate-700 sm:text-lg">
            Search by idea, method, professor, or pathway. Yale Research maps undergraduate
            curiosity to research structures, evidence, and practical next steps.
          </p>
          <div className="mt-6 grid gap-2 text-left sm:grid-cols-3">
            {['Research homes', 'Evidence', 'Best next steps'].map((item) => (
              <div key={item} className="yr-card rounded-md px-3 py-3">
                <p className="text-sm font-semibold text-slate-950">{item}</p>
              </div>
            ))}
          </div>
        </section>

        <section
          aria-label="Yale CAS sign in"
          className="yr-panel mx-auto w-full max-w-[390px] rounded-md p-5 sm:p-6"
        >
          <p className="yr-kicker">
            Yale CAS
          </p>
          <h2 className="mt-2 text-xl font-semibold text-slate-950">
            {destination.heading}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            {destination.description}
          </p>
          <div className="yr-muted-surface mt-5 rounded-md p-3">
            <p className="text-xs font-semibold text-slate-500">
              Authentication is handled by Yale CAS. Yale Research does not ask for your password.
            </p>
          </div>
          <div className="mt-5 flex min-h-[44px] items-center">
            {isLoading ? (
              <PulseLoader color="#00356b" size={10} />
            ) : isAuthenticated ? (
              <Navigate to={getRedirectPath()} replace />
            ) : (
              <SignInButton />
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

export default Login;
