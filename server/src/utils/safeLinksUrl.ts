const SAFELINKS_HOST_PATTERN = /(^|\.)safelinks\.protection\.outlook\.com$/i;
const MAX_SAFELINKS_UNWRAP_DEPTH = 5;

function safeLinksInnerUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!SAFELINKS_HOST_PATTERN.test(url.hostname)) return null;
    const inner = url.searchParams.get('url');
    if (!inner) return null;
    const decoded = inner.trim();
    return /^https?:\/\//i.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * Microsoft Outlook rewrites links in mailed content as "safelinks" wrappers
 * (`https://<tenant>.safelinks.protection.outlook.com/?url=<encoded target>&...`).
 * When a Yale directory page is authored from such content, the real personal or
 * lab site is buried in the `url=` query param; storing the wrapper verbatim
 * defeats description harvest (the wrapper is not fetchable as the site) and
 * makes every wrapped URL collide on the bare wrapper host once query strings are
 * dropped for exact-duplicate detection. Unwrap to the inner target so both paths
 * see the real URL. Non-safelinks URLs are returned unchanged.
 */
export function unwrapMicrosoftSafeLinksUrl(value: unknown): string {
  let current = typeof value === 'string' ? value.trim() : '';
  for (let depth = 0; depth < MAX_SAFELINKS_UNWRAP_DEPTH; depth += 1) {
    const inner = safeLinksInnerUrl(current);
    if (!inner) break;
    current = inner;
  }
  return current;
}
