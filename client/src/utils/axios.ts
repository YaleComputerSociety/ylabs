/**
 * Configured Axios instance with base URL and credentials.
 */
import axios from 'axios';
import { getApiBaseUrl } from './apiBaseUrl';
import { dispatchAuthRequired, dispatchRateLimited } from './httpStatusEvents';

const client = axios.create({
  withCredentials: true,
  baseURL: getApiBaseUrl(),
});

client.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    if (status === 401 && typeof window !== 'undefined') {
      dispatchAuthRequired();
    }
    if (status === 429 && typeof window !== 'undefined') {
      const retryHeader = error.response?.headers?.['retry-after'];
      const retryAfterSeconds = Number.isFinite(Number(retryHeader))
        ? Number(retryHeader)
        : error.response?.data?.retryAfterSeconds;
      dispatchRateLimited({
        message: error.response?.data?.error || 'Too many requests.',
        retryAfterSeconds,
      });
    }
    return Promise.reject(error);
  },
);

export default client;
