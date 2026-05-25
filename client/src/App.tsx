/**
 * Root application component with route definitions.
 */
import PrivateRoute from './components/PrivateRoute';
import UnprivateRoute from './components/UnprivateRoute';
import AdminRoute from './components/AdminRoute';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import RootRedirect from './pages/rootRedirect';
import Home from './pages/home';
import Fellowships from './pages/fellowships';
import Research from './pages/research';
import ResearchDetail from './pages/labDetail';
import Pathways from './pages/pathways';
import OpportunityDetail from './pages/opportunityDetail';
import Login from './pages/login';
import About from './pages/about';
import Account from './pages/account';
import Profile from './pages/profile';
import Unknown from './pages/unknown';
import LoginError from './pages/loginError';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import Analytics from './pages/analytics';
import NotFound from './pages/notFound';
import ConfigContextProvider from './providers/ConfigContextProvider';
import SearchContextProvider from './providers/SearchContextProvider';
import FellowshipSearchContextProvider from './providers/FellowshipSearchContextProvider';
import UIContextProvider from './providers/UIContextProvider';
import ScrollToTop from './components/shared/ScrollToTop';

const App = () => {
  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ScrollToTop />
      <ConfigContextProvider>
        <SearchContextProvider>
          <FellowshipSearchContextProvider>
            <UIContextProvider>
              <div className="flex flex-col h-full overflow-hidden">
                <div className="flex-shrink-0 flex-grow-0">
                  <Navbar />
                </div>
                <div className="flex-grow overflow-y-auto flex flex-col" data-scroll-container>
                  <main className="flex-grow">
                    <Routes>
                      <Route
                        path="/"
                        element={<PrivateRoute Component={RootRedirect} unknownBlocked={true} />}
                      />
                      <Route
                        path="/listings"
                        element={<PrivateRoute Component={Home} unknownBlocked={true} />}
                      />
                      <Route
                        path="/fellowships"
                        element={<PrivateRoute Component={Fellowships} unknownBlocked={true} />}
                      />
                      <Route
                        path="/programs"
                        element={<PrivateRoute Component={Fellowships} unknownBlocked={true} />}
                      />
                      <Route
                        path="/research"
                        element={<PrivateRoute Component={Research} unknownBlocked={true} />}
                      />
                      <Route
                        path="/research/:slug"
                        element={<PrivateRoute Component={ResearchDetail} unknownBlocked={true} />}
                      />
                      <Route
                        path="/pathways"
                        element={<PrivateRoute Component={Pathways} unknownBlocked={true} />}
                      />
                      <Route
                        path="/opportunities/:id"
                        element={<PrivateRoute Component={OpportunityDetail} unknownBlocked={true} />}
                      />
                      <Route
                        path="/about"
                        element={<PrivateRoute Component={About} unknownBlocked={true} />}
                      />
                      <Route
                        path="/account"
                        element={<PrivateRoute Component={Account} unknownBlocked={true} />}
                      />
                      <Route
                        path="/profile/:netid"
                        element={<PrivateRoute Component={Profile} unknownBlocked={true} />}
                      />
                      <Route path="/analytics" element={<AdminRoute Component={Analytics} />} />
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
        </SearchContextProvider>
      </ConfigContextProvider>
    </Router>
  );
};

export default App;
