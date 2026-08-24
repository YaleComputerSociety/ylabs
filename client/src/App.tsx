/**
 * Root application component with route definitions.
 */
import { lazy, Suspense } from 'react';
import PrivateRoute from './components/PrivateRoute';
import PublicRoute from './components/PublicRoute';
import UnprivateRoute from './components/UnprivateRoute';
import AdminRoute from './components/AdminRoute';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import RootRedirect from './pages/rootRedirect';
import Fellowships from './pages/fellowships';
import Research from './pages/research';
import ResearchDetail from './pages/labDetail';
import ResearchPerson from './pages/researchPerson';
import ResearchDepartment from './pages/researchDepartment';
import Login from './pages/login';
import About from './pages/about';
import Account from './pages/account';
import Profile from './pages/profile';
import Unknown from './pages/unknown';
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
                  <Routes>
                    <Route
                      path="/"
                      element={<PublicRoute Component={RootRedirect} unknownBlocked={true} />}
                    />
                    <Route
                      path="/listings"
                      element={
                        <PrivateRoute Component={RetiredListingsRedirect} unknownBlocked={true} />
                      }
                    />
                    <Route
                      path="/fellowships"
                      element={
                        <PrivateRoute
                          Component={RetiredFellowshipsRedirect}
                          unknownBlocked={true}
                        />
                      }
                    />
                    <Route
                      path="/programs"
                      element={<PrivateRoute Component={Fellowships} unknownBlocked={true} />}
                    />
                    <Route
                      path="/research"
                      element={<PublicRoute Component={Research} unknownBlocked={true} />}
                    />
                    <Route
                      path="/research/person/:publicKey"
                      element={<PublicRoute Component={ResearchPerson} unknownBlocked={true} />}
                    />
                    <Route
                      path="/research/department/:slug"
                      element={
                        <PrivateRoute Component={ResearchDepartment} unknownBlocked={true} />
                      }
                    />
                    <Route
                      path="/research/:slug"
                      element={<PublicRoute Component={ResearchDetail} unknownBlocked={true} />}
                    />
                    <Route
                      path="/about"
                      element={<PublicRoute Component={About} unknownBlocked={true} />}
                    />
                    <Route
                      path="/account"
                      element={<PrivateRoute Component={Account} unknownBlocked={true} />}
                    />
                    <Route
                      path="/profile/:netid"
                      element={<PrivateRoute Component={Profile} unknownBlocked={true} />}
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
                    <Route
                      path="/unknown"
                      element={<PrivateRoute Component={Unknown} knownBlocked={true} />}
                    />
                    <Route path="*" element={<NotFound />} />
                  </Routes>
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
