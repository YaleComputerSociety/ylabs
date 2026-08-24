export const SAME_NAME_PROFILE_CTA_GRAFTS: Record<string, string> = {
  'nih-pi-aaron-wolfe': 'https://medicine.yale.edu/profile/aaron-wolfe/',
  'samuels-mas278': 'https://medicine.yale.edu/profile/maurice-samuels/',
};

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function normalizeUrlForCompare(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '').toLowerCase() : '';
}

const isHttpUrl = (value: unknown): boolean =>
  typeof value === 'string' && /^https?:\/\//i.test(value.trim());

export function shouldClearGraftedWebsite(currentWebsite: unknown, wrongUrl: string): boolean {
  const current = normalizeUrlForCompare(currentWebsite);
  return current !== '' && current === normalizeUrlForCompare(wrongUrl);
}

export function planSourceUrlPurge(
  currentSourceUrls: unknown,
  wrongUrl: string,
): { after: string[]; removed: string[]; safeToApply: boolean } {
  const before = asStringArray(currentSourceUrls);
  const wrong = normalizeUrlForCompare(wrongUrl);
  const after = before.filter((u) => normalizeUrlForCompare(u) !== wrong);
  const removed = before.filter((u) => normalizeUrlForCompare(u) === wrong);
  const safeToApply = removed.length > 0 && after.some(isHttpUrl);
  return { after, removed, safeToApply };
}
