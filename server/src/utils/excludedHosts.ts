/**
 * Hosts a run must not fetch at all, for example one whose flood control has banned
 * this machine, where every request can extend the ban. `www.`, a trailing dot and
 * subdomains of an excluded host are excluded with it. Shared by every probe that
 * follows redirects, because a redirect from another host is still a request to the
 * excluded one.
 */
export function normalizeExcludedHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^www\./, '');
}

export function isExcludedHostname(
  hostname: string | null | undefined,
  excludedHosts: readonly string[],
): boolean {
  if (!hostname || excludedHosts.length === 0) return false;
  const host = normalizeExcludedHost(hostname);
  return excludedHosts.some((excluded) => host === excluded || host.endsWith(`.${excluded}`));
}

export function isOnExcludedHost(url: string, excludedHosts: readonly string[]): boolean {
  if (excludedHosts.length === 0) return false;
  try {
    return isExcludedHostname(new URL(url).hostname, excludedHosts);
  } catch {
    return false;
  }
}

export const EXCLUDED_HOST_ERROR_CODE = 'ERR_EXCLUDED_HOST';

/** Thrown from a redirect hook so the hop into an excluded host is never sent. */
export function excludedHostRedirectError(): Error & { code: string } {
  return Object.assign(new Error('Redirect into an excluded host was not followed'), {
    code: EXCLUDED_HOST_ERROR_CODE,
  });
}

/**
 * Whether a request failed because the redirect hook refused an excluded host. axios
 * (through follow-redirects) wraps the hook's error twice, as
 * ERR_FR_REDIRECTION_FAILURE, so the original code sits on a `cause`.
 */
export function isExcludedHostRedirectError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
    if ((current as { code?: unknown }).code === EXCLUDED_HOST_ERROR_CODE) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
