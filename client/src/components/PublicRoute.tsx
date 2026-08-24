/**
 * Route guard for public read-only discovery surfaces.
 * Logged-out visitors see the component; logged-in users are routed exactly as
 * PrivateRoute would (unknown users to onboarding when unknownBlocked).
 */
import { Navigate } from 'react-router-dom';
import { useContext, FunctionComponent } from 'react';
import UserContext from '../contexts/UserContext';
import LoadingSpinner from './shared/LoadingSpinner';

interface PublicRouteProps {
  Component: FunctionComponent;
  unknownBlocked?: boolean;
}

const PublicRoute = ({ Component, unknownBlocked }: PublicRouteProps) => {
  const { user, isLoading } = useContext(UserContext);

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <LoadingSpinner size="lg" inline />
      </div>
    );
  }

  if (user && unknownBlocked && user.userType === 'unknown') {
    return <Navigate to="/unknown" />;
  }

  return <Component />;
};

export default PublicRoute;
