import { isKnownDeadSourceUrl } from './sourceLinkHealth';

/**
 * What a served url does when the corpus positively knows its page is gone, decided
 * once for every surface that serves one.
 *
 * Four rules, and the reason they live together is that they were previously four
 * per-field decisions and two of them ended up opposite on a single rendered list:
 * after #3292 a dead `sourceUrls` entry was dropped while a dead `websiteUrl` was still
 * added and marked, so the same Sources list qualified one dead citation and silently
 * hid another (#3312).
 *
 * 1. **A dead citation stays, qualified.** `sourceUrls`, `sourceFieldContributions` and
 *    the `websiteUrl` entry AS A CITATION remain in the Sources list marked unavailable.
 *    They are the record of what a page cited, and #2556 decided this in as many words:
 *    "the citation itself survives in the Sources list, qualified, because it is real
 *    provenance". `researchDetailSources` sets `isLikelyUnavailable` per source from the
 *    health record and groups the unavailable ones last on purpose, so withholding the
 *    url starves the pathway built to qualify it. Never silently dropped.
 * 2. **A dead access-signal url is withheld, and the `excerpt` is kept.** An access
 *    signal is an instruction telling a student how to get involved rather than
 *    provenance a reader may audit, so a student following it gets nowhere while the
 *    excerpt preserves what it said. The signal itself is NOT retired, because a 404 is
 *    not evidence a programme ended: a removed url is equally a renamed one, which is
 *    why `classifyYaleProfilePersonPresence` treats every non-2xx as indeterminate
 *    (#3144).
 * 3. **The `websiteUrl` call-to-action is suppressed separately**, which
 *    `isUnreachableResearchWebsiteCtaUrl` already does at render, while the same url
 *    still appears in Sources under rule 1. A broken button and a historical citation
 *    are different things about one url, and only the button is an offer.
 * 4. **One owner.** Every surface asks here rather than growing its own withhold, which
 *    is the lesson of a health verdict having had exactly one consumer (#2531) and then
 *    acquiring inconsistent ones.
 *
 * Absence of a verdict is never a verdict: only a positive unavailable decides anything,
 * because withholding on silence would empty the list. `isKnownDeadSourceUrl` is reached
 * only by a 404 or 410, a dead DNS or connection error, or a soft 404; 403, 429, 5xx, a
 * timeout and a TLS failure all classify `UNKNOWN`, and a private address is a separate
 * axis. An answering server and an unroutable host are different claims from "the page
 * is removed".
 */
export type ServedCitationKind =
  /** A record of where a stored value came from. Survives a dead verdict, qualified. */
  | 'provenance'
  /** A claim about how to get involved. Withheld on a dead verdict, excerpt kept. */
  | 'instruction';

export function servedCitationIsWithheld(
  kind: ServedCitationKind,
  storedSourceLinkHealth: unknown,
  url: unknown,
): boolean {
  if (kind === 'provenance') return false;
  return isKnownDeadSourceUrl(storedSourceLinkHealth, url);
}

/**
 * The url a surface may serve for this citation, or `undefined` when the policy
 * withholds it. Provided so a call site states its KIND and never re-spells the rule.
 */
export function servedCitationUrl(
  kind: ServedCitationKind,
  storedSourceLinkHealth: unknown,
  url: string | undefined,
): string | undefined {
  if (!url) return undefined;
  return servedCitationIsWithheld(kind, storedSourceLinkHealth, url) ? undefined : url;
}
