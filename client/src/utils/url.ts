/**
 * URL construction utilities for API endpoints.
 */
export const ensureHttpPrefix = (url: string): string => {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `https://${url}`;
};
