import { publicContactEmail } from './contactEmail';
import { sanitizeEvidenceExcerpt } from './descriptionHygiene';
import { isPublicHttpUrl } from './urlSafety';

export const publicAccessExcerpt = (value: unknown): string | undefined => {
  const text = String(value || '').trim();
  if (!text) return undefined;
  return sanitizeEvidenceExcerpt(text) || undefined;
};

export const publicAccessEmail = (value: unknown): string | undefined => publicContactEmail(value);

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

export const publicAccessHttpUrls = (values: unknown): string[] =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [values])
        .map(publicAccessHttpUrl)
        .filter((url): url is string => Boolean(url)),
    ),
  );
