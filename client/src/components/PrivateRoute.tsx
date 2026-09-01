/**
 * Route guard that redirects unauthenticated users to login.
 */
import { Navigate, useLocation } from 'react-router-dom';
import { useContext, FunctionComponent } from 'react';
import UserContext from '../contexts/UserContext';
import LoadingSpinner from './shared/LoadingSpinner';

interface PrivateRouteProps {
  Component: FunctionComponent;
}

const PrivateRoute = ({ Component }: PrivateRouteProps) => {
  const { isLoading, isAuthenticated } = useContext(UserContext);
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

  return <Component />;
};

export default PrivateRoute;
