/**
 * Configured Axios instance with base URL and credentials.
 */
import axios from 'axios';
import { dispatchAuthFailure, dispatchRateLimit, getRateLimitDetail } from './httpStatusEvents';

const backendBaseURL = window.location.host.includes('yalelabs.io')
  ? 'https://yalelabs.io/api'
  : import.meta.env.VITE_APP_SERVER + '/api';

const apiClient = axios.create({
  withCredentials: true,
  baseURL: backendBaseURL,
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;

    if (status === 401) {
      dispatchAuthFailure({
        status: 401,
        path: error.response.config?.url,
      });
    }

    if (status === 429) {
      dispatchRateLimit(getRateLimitDetail(error.response));
    }

    return Promise.reject(error);
  },
);

export default apiClient;
