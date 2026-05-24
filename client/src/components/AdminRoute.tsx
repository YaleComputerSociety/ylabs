/**
 * Route guard that restricts access to admin users only.
 */
import { Navigate } from 'react-router-dom';
import { useContext, FunctionComponent, useEffect } from 'react';
import UserContext from '../contexts/UserContext';
import { buildApiUrl } from '../utils/apiBaseUrl';

interface AdminRouteProps {
  Component: FunctionComponent;
}

const getLocalAdminDevLoginUrl = () => {
  const isLocalDevHost =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  if (!import.meta.env.DEV || !isLocalDevHost) {
    return null;
  }

  return buildApiUrl(`/dev-login?userType=admin&redirect=${encodeURIComponent(
    window.location.href,
  )}`);
};

const AdminRoute = ({ Component }: AdminRouteProps) => {
  const { user, isLoading, isAuthenticated } = useContext(UserContext);
  const localAdminDevLoginUrl = getLocalAdminDevLoginUrl();

  useEffect(() => {
    if (
      !isLoading &&
      localAdminDevLoginUrl &&
      (!isAuthenticated || (user && user.userType !== 'admin'))
    ) {
      window.location.assign(localAdminDevLoginUrl);
    }
  }, [isAuthenticated, isLoading, localAdminDevLoginUrl, user]);

  if (isLoading) {
    return null;
  }

  if (!isAuthenticated) {
    if (localAdminDevLoginUrl) {
      return (
        <div className="flex min-h-[50vh] items-center justify-center px-4 text-center text-gray-600">
          Opening local admin session...
        </div>
      );
    }

    return <Navigate to="/login" />;
  }

  if (user && user.userType === 'unknown') {
    if (localAdminDevLoginUrl) {
      return (
        <div className="flex min-h-[50vh] items-center justify-center px-4 text-center text-gray-600">
          Opening local admin session...
        </div>
      );
    }

    return <Navigate to="/unknown" />;
  }

  if (user && user.userType !== 'admin') {
    if (localAdminDevLoginUrl) {
      return (
        <div className="flex min-h-[50vh] items-center justify-center px-4 text-center text-gray-600">
          Opening local admin session...
        </div>
      );
    }

    return <Navigate to="/" />;
  }

  return <Component />;
};

export default AdminRoute;
