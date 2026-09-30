/**
 * Route guard for public read-only discovery surfaces.
 * Logged-out visitors and authenticated users alike see the component.
 */
import { FunctionComponent } from 'react';

interface PublicRouteProps {
  Component: FunctionComponent;
}

const PublicRoute = ({ Component }: PublicRouteProps) => <Component />;

export default PublicRoute;
