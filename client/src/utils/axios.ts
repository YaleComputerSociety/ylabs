/**
 * Configured Axios instance with base URL and credentials.
 */
import axios from 'axios';
import { getApiBaseUrl } from './apiBaseUrl';
import { dispatchHttpStatusEvent } from './httpStatusEvents';

const client = axios.create({
  withCredentials: true,
  baseURL: getApiBaseUrl(),
});

client.interceptors.response.use(
  (response) => response,
  (error) => {
    dispatchHttpStatusEvent(
      error?.response?.status,
      error?.response?.headers?.['retry-after'],
      error?.response?.data,
    );
    return Promise.reject(error);
  },
);

export default client;
