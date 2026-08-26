import { isPublicHttpUrl } from './urlSafety';

export const publicAccessHttpUrl = (value: unknown): string | undefined => {
  const raw = String(value || '').trim();
  if (!raw) return undefined;

  try {
    const url = new URL(raw);
    return isPublicHttpUrl(raw) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};
