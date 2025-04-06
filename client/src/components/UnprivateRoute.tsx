import { Navigate } from 'react-router-dom';
import { useContext, FunctionComponent } from 'react';
import UserContext from '../contexts/UserContext';

interface UnprivateRouteProps {
  Component: FunctionComponent;
}

const UnprivateRoute = ({ Component } : UnprivateRouteProps) => {
 
  const { user } = useContext(UserContext);

  return user ? <Navigate to='/' /> : <Component />;
};
export default UnprivateRoute;