/**
 * Root application component with route definitions.
 */
import { lazy, Suspense, type ReactNode } from 'react';
import PrivateRoute from './components/PrivateRoute';
import PublicRoute from './components/PublicRoute';
import UnprivateRoute from './components/UnprivateRoute';
import AdminRoute from './components/AdminRoute';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import RootRedirect from './pages/rootRedirect';
import Research from './pages/research';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import NotFound from './pages/notFound';
import ConfigContextProvider from './providers/ConfigContextProvider';
import FellowshipSearchContextProvider from './providers/FellowshipSearchContextProvider';
import UIContextProvider from './providers/UIContextProvider';
import ScrollToTop from './components/shared/ScrollToTop';
import HttpStatusNotifier from './components/HttpStatusNotifier';
import LoadingSpinner from './components/shared/LoadingSpinner';

// Only `/research` is eager among content pages: it is the entry point of the
// student journey and the target of the root redirect, so it must not cost a
// second round trip. The root redirect and not-found page are tiny and stay eager.
const Fellowships = lazy(() => import('./pages/fellowships'));
const ResearchDetail = lazy(() => import('./pages/labDetail'));
const Login = lazy(() => import('./pages/login'));
const About = lazy(() => import('./pages/about'));
const Dashboard = lazy(() => import('./pages/dashboard'));
const LoginError = lazy(() => import('./pages/loginError'));
const Analytics = lazy(() => import('./pages/analytics'));

const RouteLoadingFallback = () => (
  <div role="status" aria-live="polite" className="flex min-h-[50vh] items-center justify-center">
    <LoadingSpinner size="lg" inline />
    <span className="sr-only">Loading page</span>
  </div>
);

const RetiredListingsRedirect = () => <Navigate to="/research" replace />;
const RetiredFellowshipsRedirect = () => <Navigate to="/programs" replace />;
const RetiredPersonRedirect = () => <Navigate to="/research" replace />;
const RetiredAccountRedirect = () => <Navigate to="/dashboard" replace />;

const RouteFade = ({ children }: { children: ReactNode }) => {
  const { pathname } = useLocation();
  return (
    <div key={pathname} className="yr-fade-in">
      {children}
    </div>
  );
};

const App = () => {
  return (
    <Router>
      <ScrollToTop />
      <ConfigContextProvider>
        <FellowshipSearchContextProvider>
          <UIContextProvider>
            <div className="flex flex-col h-full overflow-hidden">
              <a
                href="#main-content"
                className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-overlay focus:bg-brand focus:px-4 focus:py-2 focus:text-white focus:shadow-yr-overlay yr-focus-ring"
              >
                Skip to main content
              </a>
              <div className="flex-shrink-0 flex-grow-0">
                <Navbar />
              </div>
              <div
                className="relative flex-grow overflow-y-auto flex flex-col"
                data-scroll-container
              >
                <HttpStatusNotifier />
                <main id="main-content" tabIndex={-1} className="flex-grow focus:outline-none">
                  <Suspense fallback={<RouteLoadingFallback />}>
                    <RouteFade>
                      <Routes>
                        <Route path="/" element={<PublicRoute Component={RootRedirect} />} />
                        <Route
                          path="/listings"
                          element={<PrivateRoute Component={RetiredListingsRedirect} />}
                        />
                        <Route
                          path="/fellowships"
                          element={<PrivateRoute Component={RetiredFellowshipsRedirect} />}
                        />
                        <Route
                          path="/programs"
                          element={<PrivateRoute Component={Fellowships} />}
                        />
                        <Route path="/research" element={<PublicRoute Component={Research} />} />
                        <Route
                          path="/research/person/:publicKey"
                          element={<RetiredPersonRedirect />}
                        />
                        <Route
                          path="/research/:slug"
                          element={<PublicRoute Component={ResearchDetail} />}
                        />
                        <Route path="/about" element={<PublicRoute Component={About} />} />
                        <Route
                          path="/account"
                          element={<PrivateRoute Component={RetiredAccountRedirect} />}
                        />
                        <Route path="/dashboard" element={<PrivateRoute Component={Dashboard} />} />
                        <Route path="/analytics" element={<AdminRoute Component={Analytics} />} />
                        <Route path="/login" element={<Login />} />
                        <Route
                          path="/login-error"
                          element={<UnprivateRoute Component={LoginError} />}
                        />
                        <Route path="*" element={<NotFound />} />
                      </Routes>
                    </RouteFade>
                  </Suspense>
                </main>
                <Footer />
              </div>
            </div>
          </UIContextProvider>
        </FellowshipSearchContextProvider>
      </ConfigContextProvider>
    </Router>
  );
};

export default App;
