import { Navigate } from "react-router-dom";
import { useContext, FunctionComponent } from "react";
import UserContext from "../contexts/UserContext";

const PrivateRoute = ({ Component }: { Component: FunctionComponent}) => {
 
  const { isLoading, isAuthenticated } = useContext(UserContext);
 
  return isAuthenticated ? <Component /> : <Navigate to="/login" />;
};
export default PrivateRoute;