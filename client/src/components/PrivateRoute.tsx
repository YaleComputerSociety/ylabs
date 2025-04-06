import { Navigate } from 'react-router-dom';
import { useContext, FunctionComponent } from 'react';
import UserContext from '../contexts/UserContext';

interface PrivateRouteProps {
  Component: FunctionComponent;
  unknownBlocked?: boolean;
  knownBlocked?: boolean;
}

const PrivateRoute = ({ Component, unknownBlocked, knownBlocked } : PrivateRouteProps) => {
  const { user, isLoading, isAuthenticated } = useContext(UserContext);

  // Don't redirect while checking authentication
  if (isLoading) {
    return null;
  }

  // If not authenticated, redirect to login
  if (!isAuthenticated) {
    return <Navigate to='/login' />;
  }

  // Handle user type-based routing
  if (user) {
    if (unknownBlocked && user.userType === "unknown") {
      return <Navigate to='/unknown' />;
    }
    if (knownBlocked && user.userType !== "unknown") {
      return <Navigate to='/' />;
    }
  }

  // If all checks pass, render the component
  return <Component />;
};

export default PrivateRoute;