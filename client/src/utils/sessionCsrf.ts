import axios from './axios';

export const SESSION_CSRF_HEADER = 'X-CSRF-Token';
export const SESSION_CSRF_TOKEN_PATH = '/users/me/csrf-token';

type RequestConfig = Parameters<typeof axios.get>[1];

export const sessionCsrfHeaders = async (
  path: string = SESSION_CSRF_TOKEN_PATH,
  config?: RequestConfig,
): Promise<Record<string, string>> => {
  const { data } = await axios.get<{ csrfToken?: unknown }>(path, config);
  return { [SESSION_CSRF_HEADER]: String(data?.csrfToken ?? '') };
};
