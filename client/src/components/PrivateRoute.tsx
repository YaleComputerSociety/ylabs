/**
 * Route guard that redirects unauthenticated users to login.
 */
import { Navigate, useLocation } from 'react-router-dom';
import { useContext, FunctionComponent } from 'react';
import UserContext from '../contexts/UserContext';
import LoadingSpinner from './shared/LoadingSpinner';

interface PrivateRouteProps {
  Component: FunctionComponent;
  unknownBlocked?: boolean;
  knownBlocked?: boolean;
}

const PrivateRoute = ({ Component, unknownBlocked, knownBlocked }: PrivateRouteProps) => {
  const { user, isLoading, isAuthenticated } = useContext(UserContext);
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <LoadingSpinner size="lg" inline />
      </div>
    );
  }

  if (!isAuthenticated) {
    const returnPath = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to="/login" state={{ from: returnPath }} replace />;
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
