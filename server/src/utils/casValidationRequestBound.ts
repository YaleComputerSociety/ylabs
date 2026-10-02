import { createRequire } from 'node:module';
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios';

const INSTALLED_INTERCEPTOR = Symbol.for('ylabs.casValidationRequestBound.interceptor');

type BoundableClient = AxiosInstance & { [INSTALLED_INTERCEPTOR]?: number };

export const casStrategyHttpClient = (): AxiosInstance => {
  const requireFromServer = createRequire(import.meta.url);
  const requireFromStrategy = createRequire(requireFromServer.resolve('passport-cas'));
  const loaded = requireFromStrategy('axios') as AxiosInstance & { default?: AxiosInstance };
  return loaded.default ?? loaded;
};

export const isCasServerRequest = (url: unknown, ssoBaseURL: string): boolean =>
  typeof url === 'string' &&
  ssoBaseURL.length > 0 &&
  (url === ssoBaseURL || url.startsWith(`${ssoBaseURL.replace(/\/+$/, '')}/`));

export function boundCasServerRequests(
  client: AxiosInstance,
  ssoBaseURL: string,
  timeoutMs: number,
): void {
  const boundable = client as BoundableClient;
  const installed = boundable[INSTALLED_INTERCEPTOR];
  if (installed !== undefined) boundable.interceptors.request.eject(installed);

  boundable[INSTALLED_INTERCEPTOR] = boundable.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
      if (!isCasServerRequest(config.url, ssoBaseURL)) return config;
      config.timeout =
        config.timeout && config.timeout > 0 ? Math.min(config.timeout, timeoutMs) : timeoutMs;
      config.signal ??= AbortSignal.timeout(timeoutMs);
      return config;
    },
  );
}
