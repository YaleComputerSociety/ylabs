import { Navigate } from 'react-router-dom';
import { useContext, FunctionComponent } from 'react';
import UserContext from '../contexts/UserContext';

interface PrivateRouteProps {
  Component: FunctionComponent;
  unknownBlocked?: boolean;
  knownBlocked?: boolean;
}

const PrivateRoute = ({ Component, unknownBlocked, knownBlocked } : PrivateRouteProps) => {
 
  const { user } = useContext(UserContext);

  return user ? 
    unknownBlocked && user.userType === "unknown" ? 
      <Navigate to='/unknown' /> : knownBlocked && user.userType !== "unknown" ?
        <Navigate to='/' /> : <Component />
      : <Navigate to='/login' />;
};
export default PrivateRoute;