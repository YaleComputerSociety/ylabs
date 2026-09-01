export const SCHOLAR_PROFILE_LINK_URL_MAXLENGTH = 2048;

const cleanString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export function canonicalScholarCitationUrl(value: unknown): string | undefined {
  const candidate = cleanString(value);
  if (!candidate || candidate.length > SCHOLAR_PROFILE_LINK_URL_MAXLENGTH) return undefined;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }
  if (url.username || url.password) return undefined;
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  if (url.hostname !== 'scholar.google.com') return undefined;
  if (url.pathname !== '/citations') return undefined;
  const scholarUserId = url.searchParams.get('user');
  if (!scholarUserId || !/^[A-Za-z0-9_-]+$/.test(scholarUserId)) return undefined;
  return `https://scholar.google.com/citations?user=${scholarUserId}`;
}
