export interface DeadLabHomeCandidate {
  websiteUrl?: unknown;
  sourceUrls?: unknown;
}

export type DeadLabHomeVerdict = 'not-a-ysm-lab-url' | 'in-index' | 'live-not-in-index' | 'clear';

export const YSM_LAB_HOME = /^https?:\/\/medicine\.yale\.edu\/lab\/([^/?#]+)/i;

/**
 * The A-Z index lists a lab under a path segment that is often a PI surname while
 * its display name is a programme name (`/lab/melnick/` is "ACCELERATE Lab"), so a
 * segment can never be derived from a name or a name from a segment. Compare
 * segments only, and normalise `_` to `-` because two rows store the underscore
 * form of a hyphenated index entry.
 */
export function labSegment(url: unknown): string {
  const match = YSM_LAB_HOME.exec(String(url ?? ''));
  if (!match) return '';
  return match[1].toLowerCase().replace(/_/g, '-');
}

/**
 * Index membership is valid POSITIVE evidence and invalid negative evidence: two
 * sampled rows are live, correctly titled, and absent from the index because they
 * are School of Public Health labs on the `medicine.yale.edu` host (#2626). So a
 * missing segment never condemns a row on its own; only a failed liveness probe
 * does.
 */
export function classifyLabHome(
  entity: DeadLabHomeCandidate,
  indexSegments: ReadonlySet<string>,
  httpStatus: number | undefined,
): DeadLabHomeVerdict {
  const segment = labSegment(entity.websiteUrl);
  if (!segment) return 'not-a-ysm-lab-url';
  if (indexSegments.has(segment)) return 'in-index';
  if (httpStatus === 200) return 'live-not-in-index';
  return 'clear';
}

/**
 * Parses `/lab/<segment>` links out of the A-Z index page. Returning an empty set
 * is treated by the caller as an ABORT rather than as "nothing is indexed": an
 * unreachable index would otherwise condemn every live lab at once, which is the
 * failure mode a fail-closed rule needs an availability guard for.
 */
export function parseIndexSegments(html: string): Set<string> {
  const out = new Set<string>();
  for (const match of html.matchAll(/\/lab\/([a-z0-9][a-z0-9._-]*)\/?/gi)) {
    const segment = match[1].toLowerCase().replace(/_/g, '-');
    if (segment && !segment.includes('.')) out.add(segment);
  }
  return out;
}

export const MINIMUM_CREDIBLE_INDEX_SIZE = 100;

/**
 * A truncated or error page can still yield a handful of `/lab/` links, so a size
 * floor distinguishes "the index loaded" from "we got something". The live index
 * carries 262 entries; 100 leaves room for genuine shrinkage without accepting a
 * fragment.
 */
export function isCredibleIndex(segments: ReadonlySet<string>): boolean {
  return segments.size >= MINIMUM_CREDIBLE_INDEX_SIZE;
}
