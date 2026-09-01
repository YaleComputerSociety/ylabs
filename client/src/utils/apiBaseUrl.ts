const LOCAL_SERVER_ORIGIN = 'http://localhost:4000';
const PRODUCTION_SERVER_ORIGIN = 'https://yalelabs.io';
const MAX_BACKEND_ORIGIN_LENGTH = 2048;
const hasUnsafeBackendOriginCharacter = (value: string): boolean =>
  Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return isAsciiControlCode(code) || code === 0x20 || character === '\\';
  });

const trimTrailingSlashes = (value: string) => value.replace(/\/+$/, '');

const removeApiSuffix = (value: string) => value.replace(/\/api$/i, '');

export const isProductionWebHost = (host: string): boolean => {
  const hostname = host.split(':')[0]?.toLowerCase() || '';
  return hostname === 'yalelabs.io' || hostname === 'www.yalelabs.io';
};

export const normalizeBackendOrigin = (value: unknown, fallback = LOCAL_SERVER_ORIGIN): string => {
  if (typeof value !== 'string') return fallback;
  const trimmed = trimTrailingSlashes(value.trim());
  if (!trimmed) return fallback;
  if (trimmed.length > MAX_BACKEND_ORIGIN_LENGTH) return fallback;
  if (hasUnsafeBackendOriginCharacter(trimmed)) return fallback;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return fallback;
    if (parsed.username || parsed.password) return fallback;
    const pathPrefix = removeApiSuffix(trimTrailingSlashes(parsed.pathname));
    return `${parsed.origin}${pathPrefix === '/' ? '' : pathPrefix}`;
  } catch {
    return fallback;
  }
};

export const getBackendOrigin = () => {
  if (isProductionWebHost(window.location.host)) {
    return PRODUCTION_SERVER_ORIGIN;
  }

  const configuredServer = import.meta.env.VITE_APP_SERVER || LOCAL_SERVER_ORIGIN;
  return normalizeBackendOrigin(configuredServer);
};

export const getApiBaseUrl = () => `${getBackendOrigin()}/api`;

export const buildApiUrl = (path: string) => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getApiBaseUrl()}${normalizedPath}`;
};
import { isAsciiControlCode } from './asciiControl';
