/**
 * Route guard that restricts access to admin users only.
 */
import { Navigate } from 'react-router-dom';
import { useContext, FunctionComponent } from 'react';
import UserContext from '../contexts/UserContext';

interface AdminRouteProps {
  Component: FunctionComponent;
}

const AdminRoute = ({ Component }: AdminRouteProps) => {
  const { user, isLoading, isAuthenticated } = useContext(UserContext);

  if (isLoading) {
    return null;
  }

  if (!isAuthenticated) {
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
