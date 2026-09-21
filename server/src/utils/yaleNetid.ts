/**
 * Single owner of what a Yale netid looks like. Twelve modules previously declared
 * this shape independently while the scraper mint path contradicted all of them,
 * which is the root cause recorded in #2863: a slot whose authority lives in a
 * different module than the write.
 */
const YALE_NETID_PATTERN = /^[A-Za-z0-9]{2,12}$/;
const NORMALIZED_YALE_NETID_PATTERN = /^[a-z0-9]{2,12}$/;

export function looksLikeYaleNetid(value: unknown): boolean {
  return typeof value === 'string' && YALE_NETID_PATTERN.test(value.trim());
}

export function isNormalizedYaleNetid(value: unknown): boolean {
  return typeof value === 'string' && NORMALIZED_YALE_NETID_PATTERN.test(value.trim());
}

export function asYaleNetid(value: unknown): string {
  const candidate = typeof value === 'string' ? value.trim() : '';
  return YALE_NETID_PATTERN.test(candidate) ? candidate : '';
}

export function normalizedYaleNetid(value: unknown): string {
  return asYaleNetid(value).toLowerCase();
}
