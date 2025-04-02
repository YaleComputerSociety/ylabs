import { Navigate } from 'react-router-dom';
import { useContext, FunctionComponent } from 'react';
import UserContext from '../contexts/UserContext';

const PrivateRoute = ({ Component }: { Component: FunctionComponent}) => {
  const { isAuthenticated, isLoading } = useContext(UserContext);
  
  // Show nothing while checking authentication
  if (isLoading) {
    return null;
  }
 
  return isAuthenticated ? <Component /> : <Navigate to='/login' />;
};

export default PrivateRoute;