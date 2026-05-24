const LOCAL_SERVER_ORIGIN = 'http://localhost:4000';
const PRODUCTION_SERVER_ORIGIN = 'https://yalelabs.io';

const trimTrailingSlashes = (value: string) => value.replace(/\/+$/, '');

const removeApiSuffix = (value: string) => value.replace(/\/api$/i, '');

export const getBackendOrigin = () => {
  if (window.location.host.includes('yalelabs.io')) {
    return PRODUCTION_SERVER_ORIGIN;
  }

  const configuredServer = import.meta.env.VITE_APP_SERVER || LOCAL_SERVER_ORIGIN;
  return removeApiSuffix(trimTrailingSlashes(configuredServer));
};

export const getApiBaseUrl = () => `${getBackendOrigin()}/api`;

export const buildApiUrl = (path: string) => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getApiBaseUrl()}${normalizedPath}`;
};
