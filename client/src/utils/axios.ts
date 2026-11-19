/**
 * Configured Axios instance with base URL and credentials.
 */
import axios from 'axios';
import { getApiBaseUrl } from './apiBaseUrl';
import { dispatchHttpStatusEvent } from './httpStatusEvents';

declare module 'axios' {
  interface AxiosRequestConfig {
    skipAuthRequiredEvent?: boolean;
  }
}

const client = axios.create({
  withCredentials: true,
  baseURL: getApiBaseUrl(),
});

client.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    if (status === 401 && error?.config?.skipAuthRequiredEvent) return Promise.reject(error);
    dispatchHttpStatusEvent(
      status,
      error?.response?.headers?.['retry-after'],
      error?.response?.data,
    );
    return Promise.reject(error);
  },
);

export default client;
