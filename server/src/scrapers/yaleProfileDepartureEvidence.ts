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
 * suppressing a researcher who is still here. Absence requires THREE things: an
 * explicit person-less marker, no role word anywhere in the page text, and no
 * biographical prose.
 *
 * The third condition was added after the first two produced a false positive
 * (#3168). The marker is not always the page's whole content: a Yale profile
 * template can render a person's full biography AND a second, empty people view
 * whose empty state is the same string. Pair that with somebody whose bio never
 * states a title - it is entirely possible to describe teaching a language for a
 * decade without the word professor, lecturer or instructor appearing - and a
 * present, correct row satisfies both of the original conditions. Measured:
 * 1,272 live pages produced no false positive under the two-condition rule, and
 * widening the sweep from roster-absent rows to the whole served corpus found
 * one within the next 439 pages, so the clean first measurement was a property
 * of the narrower population rather than of the rule.
 *
 * Prose is the discriminator that actually separates the two, because a page
 * whose person has been unpublished has nothing left to say: on the 2 genuinely
 * unpublished rows the extracted text is the name plus the marker and 0 prose
 * sentences, while the false positive carries 2. Do not relax any of the three
 * to raise recall - a missed departure leaves a stale row for an operator, and a
 * wrong one takes a real research home away from students.
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

/**
 * A sentence long enough to be somebody's biography rather than a nav label or a
 * postal address. Twelve words is above every menu item and breadcrumb observed
 * across 1,700 Yale profile pages and below the shortest real bio sentence.
 */
const PROSE_SENTENCE = /(?:[\w''’“”(),;:–—-]+\s+){11,}[\w''’“”(),;:–—-]+[.!?]/;

/**
 * Whether the page says anything about a person, with the empty-state markers
 * removed first: on a page that renders both a biography and an empty people
 * view, the marker is not the content and must not be read as if it were.
 */
export function hasBiographicalProse(text: string): boolean {
  const withoutMarkers = PERSON_LESS_MARKERS.reduce(
    (stripped, marker) => stripped.replace(new RegExp(marker.source, 'gi'), ' '),
    text,
  );
  return PROSE_SENTENCE.test(withoutMarkers);
}

export function classifyYaleProfilePersonPresence(
  page: YaleProfilePage | null | undefined,
): YaleProfilePersonPresence {
  if (!page) return 'indeterminate';
  if (page.status < 200 || page.status >= 300) return 'indeterminate';
  const text = visibleTextFromHtml(page.html || '');
  if (!text) return 'indeterminate';
  if (ROLE_MARKER.test(text)) return 'person_present';
  if (hasBiographicalProse(text)) return 'person_present';
  return PERSON_LESS_MARKERS.some((marker) => marker.test(text))
    ? 'person_absent'
    : 'indeterminate';
}

/**
 * A path segment that introduces a person. `faculty` is matched by prefix so
 * `faculty-directory` and `faculty-officers` are covered without enumerating the
 * spellings each school invents.
 */
const PROFILE_PATH_SEGMENT = /^(?:people|persons?|profiles?|directory)$/i;

/**
 * Schools that publish a person at the root of their own host with no marker
 * segment at all, so no vocabulary can reach them: `law.yale.edu/<slug>`. This is
 * an allowlist rather than a rule because "one path segment" describes every
 * other page on those hosts too, and only a URL somebody already recorded as a
 * `YALE_OFFICIAL` profile link is ever read.
 */
const FLAT_PERSON_PATH_HOSTS: ReadonlySet<string> = new Set(['law.yale.edu']);

/**
 * Whether a URL addresses one person's Yale directory profile.
 *
 * The marker segment may sit at any depth, because several schools nest it:
 * `engineering.yale.edu/research-and-faculty/faculty-directory/<slug>`,
 * `environment.yale.edu/directory/faculty/<slug>`,
 * `macmillan.yale.edu/<region>/person/<slug>`,
 * `medicine.yale.edu/<unit>/profile/<slug>`. Requiring it first rejected 463 of
 * the 5,242 `YALE_OFFICIAL` links in the corpus, 8.8%, and left 170 served rows
 * unjudgeable by the departure lane (#3197). It failed closed, so the cost was
 * blindness rather than a bad write.
 *
 * A segment after the marker is REQUIRED, which is a tightening the widening had
 * to carry: a bare `.../people` is a directory index, and an index's empty state
 * is what a whole broken directory looks like rather than what one departure
 * looks like. Do not drop that condition to pick up a few more URLs.
 */
export function isYaleProfileUrl(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  if (!/^https?:$/i.test(parsed.protocol)) return false;
  const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
  if (!/(^|\.)yale\.edu$/i.test(host)) return false;
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length === 1 && FLAT_PERSON_PATH_HOSTS.has(host)) return true;
  const markerAt = segments.findIndex(
    (segment) => PROFILE_PATH_SEGMENT.test(segment) || /^faculty/i.test(segment),
  );
  return markerAt !== -1 && markerAt < segments.length - 1;
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
