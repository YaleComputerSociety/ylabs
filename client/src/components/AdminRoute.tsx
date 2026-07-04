/**
 * Route guard that restricts access to admin users only.
 */
import { Navigate, useLocation } from 'react-router-dom';
import { useContext, FunctionComponent } from 'react';
import UserContext from '../contexts/UserContext';

interface AdminRouteProps {
  Component: FunctionComponent;
}

const AdminRoute = ({ Component }: AdminRouteProps) => {
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

  if (user && user.userType === 'unknown') {
    return <Navigate to="/unknown" />;
  }

  if (user && user.userType !== 'admin') {
    return <Navigate to="/" />;
  }

  return <Component />;
};

export default AdminRoute;
