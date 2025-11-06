import { Navigate } from 'react-router-dom';
import { useContext, FunctionComponent } from 'react';
import UserContext from '../contexts/UserContext';

interface AdminRouteProps {
  Component: FunctionComponent;
}

const AdminRoute = ({ Component } : AdminRouteProps) => {
  const { user, isLoading, isAuthenticated } = useContext(UserContext);

  // Don't redirect while checking authentication
  if (isLoading) {
    return null;
  }

  // If not authenticated, redirect to login
  if (!isAuthenticated) {
    return <Navigate to='/login' />;
  }

  // If user type is unknown, redirect to unknown page
  if (user && user.userType === "unknown") {
    return <Navigate to='/unknown' />;
  }

  // If user is not an admin, redirect to home
  if (user && user.userType !== "admin") {
    return <Navigate to='/' />;
  }

  // If all checks pass, render the component
  return <Component />;
};

export default AdminRoute;