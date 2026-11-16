import { isYaleHostedPage } from './nonYaleMicrositeOwnership';

const NETID_PAGE_PARENTS = new Set(['people', 'profile']);
const YALE_NETID_SHAPE = /^[a-z]{2,4}[0-9]{1,5}$/;

/** A Yale `/people/<netid>` or `/profile/<netid>` page whose netid is exactly one of the lead's (#6316, #6389). */
export function isYalePeoplePageForNetid(pageUrl: string, leadNetids: readonly string[]): boolean {
  const netids = leadNetids
    .map((netid) => netid.trim().toLowerCase())
    .filter((netid) => YALE_NETID_SHAPE.test(netid));
  if (netids.length === 0 || !isYaleHostedPage(pageUrl)) return false;
  try {
    const segments = new URL(pageUrl).pathname.toLowerCase().split('/').filter(Boolean);
    return segments.some(
      (segment, index) =>
        NETID_PAGE_PARENTS.has(segment) && netids.includes(segments[index + 1] ?? ''),
    );
  } catch {
    return false;
  }
}
