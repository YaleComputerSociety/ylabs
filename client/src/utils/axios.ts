/**
 * Configured Axios instance with base URL and credentials.
 */
import axios from 'axios';
import { getApiBaseUrl } from './apiBaseUrl';

export default axios.create({
  withCredentials: true,
  baseURL: getApiBaseUrl(),
});
