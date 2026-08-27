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
import Fellowships from './pages/fellowships';
import Research from './pages/research';
import ResearchDetail from './pages/labDetail';
import Login from './pages/login';
import About from './pages/about';
import Dashboard from './pages/dashboard';
import Profile from './pages/profile';
import LoginError from './pages/loginError';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import NotFound from './pages/notFound';
import ConfigContextProvider from './providers/ConfigContextProvider';
import FellowshipSearchContextProvider from './providers/FellowshipSearchContextProvider';
import UIContextProvider from './providers/UIContextProvider';
import ScrollToTop from './components/shared/ScrollToTop';
import HttpStatusNotifier from './components/HttpStatusNotifier';
import LoadingSpinner from './components/shared/LoadingSpinner';

const Analytics = lazy(() => import('./pages/analytics'));

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
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ScrollToTop />
      <ConfigContextProvider>
        <FellowshipSearchContextProvider>
          <UIContextProvider>
            <div className="flex flex-col h-full overflow-hidden">
              <a
                href="#main-content"
                className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-brand focus:px-4 focus:py-2 focus:text-white focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                Skip to main content
              </a>
              <div className="flex-shrink-0 flex-grow-0">
                <Navbar />
              </div>
              <div className="flex-grow overflow-y-auto flex flex-col" data-scroll-container>
                <HttpStatusNotifier />
                <main id="main-content" tabIndex={-1} className="flex-grow focus:outline-none">
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
                      <Route path="/programs" element={<PrivateRoute Component={Fellowships} />} />
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
                      <Route
                        path="/profile/:netid"
                        element={<PrivateRoute Component={Profile} />}
                      />
                      <Route
                        path="/analytics"
                        element={
                          <Suspense fallback={<LoadingSpinner size="lg" />}>
                            <AdminRoute Component={Analytics} />
                          </Suspense>
                        }
                      />
                      <Route path="/login" element={<Login />} />
                      <Route
                        path="/login-error"
                        element={<UnprivateRoute Component={LoginError} />}
                      />
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </RouteFade>
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
