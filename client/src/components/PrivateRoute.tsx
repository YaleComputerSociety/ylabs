/**
 * Route guard that redirects unauthenticated users to login.
 */
import { Navigate, useLocation } from 'react-router-dom';
import { useContext, FunctionComponent } from 'react';
import UserContext from '../contexts/UserContext';

interface PrivateRouteProps {
  Component: FunctionComponent;
  unknownBlocked?: boolean;
  knownBlocked?: boolean;
}

const PrivateRoute = ({ Component, unknownBlocked, knownBlocked }: PrivateRouteProps) => {
  const { user, isLoading, isAuthenticated } = useContext(UserContext);
  const location = useLocation();

  if (isLoading) {
    return null;
  }

  if (!isAuthenticated) {
    localStorage.setItem(
      'logoutReturnPath',
      window.location.origin + location.pathname + location.search,
    );
    return <Navigate to="/login" />;
  }

  if (user) {
    if (unknownBlocked && user.userType === 'unknown') {
      return <Navigate to="/unknown" />;
    }
    if (knownBlocked && user.userType !== 'unknown') {
      return <Navigate to="/" />;
    }
  }

  return <Component />;
};

export default PrivateRoute;
