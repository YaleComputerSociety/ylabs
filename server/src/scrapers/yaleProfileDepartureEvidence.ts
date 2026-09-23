/**
 * The Yale-side signal that positively asserts a person is gone.
 *
 * #1923 was closed as "confirmed but not actionable" because every departure
 * signal available failed to assert absence rather than asserting it: an ORCID
 * end date is silent for a third of the population, an emeritus token describes
 * active work a fifth of the time, and the one instrument that looked like it
 * should corroborate - the person's Yale profile page - "still serves HTTP 200"
 * for all 20 candidates. That measurement read the status line only. A Yale
 * directory profile whose person has been unpublished still answers 200, and
 * renders the Drupal view's empty state instead of a person. So the corroborating
 * signal did exist; it was being read at the wrong layer, which is also why
 * `sourceLinkHealth` records those pages `HEALTHY`.
 *
 * The verdict is deliberately narrow, because the error this must not make is
 * suppressing a researcher who is still here. Absence requires BOTH an explicit
 * person-less marker AND the absence of any role word anywhere in the page text.
 * Measured 2026-09-23 over 1,272 live Yale profile pages (the 1,207 URLs the
 * departure lane reaches from rows absent from a complete roster snapshot, plus
 * 70 randomly sampled links across 14 hosts): 1,268 carried a role word, and the
 * 4 that did not are 4 spellings of the 2 genuinely unpublished rows. Neither
 * condition alone fires on a live page, and the pair produced no false positive.
 * Do not relax either half to raise recall.
 */

export type YaleProfilePersonPresence = 'person_present' | 'person_absent' | 'indeterminate';

export interface YaleProfilePage {
  status: number;
  html: string;
}

/**
 * Drupal and the Yale Layout Builder templates render these when a profile view
 * resolves to no person. They are empty-state strings rather than error copy: a
 * removed profile that answers 404 is link health's business (#2531), never a
 * departure assertion, because a 404 is equally what a renamed URL looks like.
 */
const PERSON_LESS_MARKERS: readonly RegExp[] = [
  /no people to display/i,
  /no results found/i,
  /no matching results/i,
  /there are no people to display/i,
  /no person(?:nel)? found/i,
];

/**
 * A page that names any appointment is describing somebody, whatever else it
 * says. Kept broad on purpose: a false `person_present` only declines to act,
 * while a false `person_absent` takes a real research home off the surface.
 */
const ROLE_MARKER =
  /professor|lecturer|instructor|scientist|researcher|fellow\b|dean\b|director|associate\b|assistant\b|scholar|chair\b|curator|postdoctoral|emerit/i;

export function visibleTextFromHtml(html: string): string {
  return html
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyYaleProfilePersonPresence(
  page: YaleProfilePage | null | undefined,
): YaleProfilePersonPresence {
  if (!page) return 'indeterminate';
  if (page.status < 200 || page.status >= 300) return 'indeterminate';
  const text = visibleTextFromHtml(page.html || '');
  if (!text) return 'indeterminate';
  if (ROLE_MARKER.test(text)) return 'person_present';
  return PERSON_LESS_MARKERS.some((marker) => marker.test(text))
    ? 'person_absent'
    : 'indeterminate';
}

export const YALE_PROFILE_URL_PATTERN =
  /^https?:\/\/[^/]*\byale\.edu\/(?:people|profile|faculty)\b/i;

export function isYaleProfileUrl(url: unknown): boolean {
  return typeof url === 'string' && YALE_PROFILE_URL_PATTERN.test(url.trim());
}

export interface YaleProfileDepartureEvidence {
  probed: number;
  assertsAbsence: boolean;
  absentUrls: string[];
  presentUrls: string[];
}

/**
 * One `person_present` vetoes the whole verdict even when another page asserts
 * absence: a professor listed on two departmental rosters who leaves one of them
 * has not left Yale, and the cross-listed case is common enough that reading any
 * single absence as departure would suppress people who are here.
 */
export async function probeYaleProfileDepartureEvidence(
  profileUrls: readonly string[],
  fetchPage: (url: string) => Promise<YaleProfilePage | null>,
): Promise<YaleProfileDepartureEvidence> {
  const urls = Array.from(new Set(profileUrls.filter(isYaleProfileUrl).map((url) => url.trim())));
  const absentUrls: string[] = [];
  const presentUrls: string[] = [];
  for (const url of urls) {
    let verdict: YaleProfilePersonPresence = 'indeterminate';
    try {
      verdict = classifyYaleProfilePersonPresence(await fetchPage(url));
    } catch {
      verdict = 'indeterminate';
    }
    if (verdict === 'person_absent') absentUrls.push(url);
    if (verdict === 'person_present') presentUrls.push(url);
  }
  return {
    probed: urls.length,
    assertsAbsence: absentUrls.length > 0 && presentUrls.length === 0,
    absentUrls,
    presentUrls,
  };
}
