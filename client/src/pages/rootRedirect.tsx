import { Navigate, useLocation } from 'react-router-dom';

const RootRedirect = () => {
  const location = useLocation();
  const params = new URLSearchParams(location.search);

  if (params.has('listing')) {
    return <Navigate to={`/listings${location.search}`} replace />;
  }

  return <Navigate to="/research" replace />;
};

export default RootRedirect;
