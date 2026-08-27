/**
 * Route guard for public read-only discovery surfaces.
 * Logged-out visitors and authenticated users alike see the component.
 */
import { useContext, FunctionComponent } from 'react';
import UserContext from '../contexts/UserContext';
import LoadingSpinner from './shared/LoadingSpinner';

interface PublicRouteProps {
  Component: FunctionComponent;
}

const PublicRoute = ({ Component }: PublicRouteProps) => {
  const { isLoading } = useContext(UserContext);

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <LoadingSpinner size="lg" inline />
      </div>
    );
  }

  return <Component />;
};

export default PublicRoute;
