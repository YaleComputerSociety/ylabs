import { buildApiUrl } from './apiBaseUrl';

/**
 * A PUT the browser keeps sending after the page unloads. It calls fetch directly because
 * axios reaches its adapter through a promise chain, which an unloading document never
 * runs, so an axios request made from `pagehide` is silently never sent.
 */
export const keepalivePut = async (path: string, body: unknown): Promise<void> => {
  const response = await fetch(buildApiUrl(path), {
    method: 'PUT',
    keepalive: true,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Keepalive PUT failed with ${response.status}`);
};
