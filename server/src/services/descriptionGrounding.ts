import { isDescriptionGroundedInSource } from '../utils/officialResearchDescription';
import {
  type SourceLinkHealth,
  isLikelyUnavailableSourceLink,
  sourceLinkHealthKey,
} from './sourceLinkHealth';

/**
 * Whether a stored description still appears on the page it cites.
 *
 * Five verdicts rather than a boolean, for the reason `classifySourceLinkHealth`
 * already encodes and that this issue's first measurement fell into: a probe run at
 * 12-way concurrency with a non-browser user agent read 1,520 of 2,922 cited pages
 * as 403 and the grounding check then ran against a block page, which reported ~0
 * groundings on a cohort whose pages were live. Only 13 of those URLs were genuinely
 * gone. A verdict vocabulary that cannot say "I could not tell" turns a throttle into
 * a retraction (#2879).
 *
 * - `GROUNDED`    the page was fetched and still carries this wording.
 * - `REWORDED`    the page was fetched, does not carry this wording, but still carries
 *                 research prose of its own. Usually OUR rewriting rather than the
 *                 publisher's: `materializedFieldValue` sanitizes on the way in and the
 *                 revoice passes turn "Our lab is dedicated to uncovering ..." into "The
 *                 <Lab> is dedicated to uncovering ...". Measured on Development, two of
 *                 three hand-read non-grounded bodies were exactly that. Not actionable,
 *                 and deliberately NOT folded into the verdict below.
 * - `UNSUPPORTED` the page was fetched and carries no research prose at all any more - a
 *                 navigation shell whose content moved to a sub-page. The one verdict
 *                 that says the citation stopped supporting a description, and the only
 *                 one the gate reads. Requires a 2xx body.
 * - `UNREACHABLE` the page asserts it is gone (404/410). Says nothing about the prose.
 * - `UNKNOWN`     anything else: a throttle, a WAF, a timeout, a private-address host, a
 *                 redirect we did not follow to a body. Never an assertion.
 */
export const descriptionGroundingVerdicts = [
  'GROUNDED',
  'REWORDED',
  'UNSUPPORTED',
  'UNREACHABLE',
  'UNKNOWN',
] as const;
export type DescriptionGroundingVerdict = (typeof descriptionGroundingVerdicts)[number];

export interface DescriptionGroundingRecheck {
  field: string;
  url: string;
  verdict: DescriptionGroundingVerdict;
  httpStatusCode?: number;
  checkedAt?: Date | string | null;
  lastAttemptedAt?: Date | string | null;
}

export interface DescriptionGroundingInput {
  linkHealth: SourceLinkHealth;
  /** The page text, present only when a 2xx body was actually read. */
  pageText?: string;
  /**
   * Whether the fetched page still offers research prose of its own, which is what
   * separates our rewriting from a page whose content left. Supplied by the caller
   * rather than derived here, because answering it needs the HTML and this module is
   * given text.
   */
  pageOffersResearchProse?: boolean;
  /**
   * Every wording of this field the row can offer: the served text AND the lane's own
   * observation values.
   *
   * More than one, because the served text is NOT what the write-time guard vetted.
   * `materializedFieldValue` sanitizes on the way in and the revoice passes rewrite a
   * first-person opener, so a body the lane copied verbatim is stored as something
   * else: measured on Development, "Our research focuses on inborn errors of phosphate
   * metabolism ..." is served as "The <Lab> conducts research on inborn errors of
   * phosphate metabolism ...". Comparing only the served text makes our own hygiene
   * read as publisher churn, which is an instrument error in the same family as the one
   * that got this issue's first measurement retracted (#2879).
   */
  candidateDescriptions: readonly unknown[];
}

/**
 * The verdict for one (description field, cited page) pair.
 *
 * Fails closed to `UNKNOWN` whenever there is no 2xx body to compare against, so no
 * transport outcome can produce `UNSUPPORTED`. `UNAVAILABLE` link health is reported as
 * `UNREACHABLE` rather than folded into `UNKNOWN` because a page that asserts it is
 * gone is a durable fact worth keeping apart from a bad afternoon.
 */
export function classifyDescriptionGrounding(
  input: DescriptionGroundingInput,
): DescriptionGroundingVerdict {
  const { linkHealth, pageText, pageOffersResearchProse, candidateDescriptions } = input;
  if (linkHealth.privateAddressHost) return 'UNKNOWN';
  if (isLikelyUnavailableSourceLink(linkHealth)) return 'UNREACHABLE';
  if (typeof pageText !== 'string' || !pageText.trim()) return 'UNKNOWN';
  const candidates = candidateDescriptions.filter(
    (candidate): candidate is string => typeof candidate === 'string' && Boolean(candidate.trim()),
  );
  if (candidates.length === 0) return 'UNKNOWN';
  if (candidates.some((candidate) => isDescriptionGroundedInSource(candidate, pageText))) {
    return 'GROUNDED';
  }
  return pageOffersResearchProse ? 'REWORDED' : 'UNSUPPORTED';
}

const DESCRIPTION_GROUNDING_STALE_DAYS = 120;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

const asDate = (value: unknown): Date | undefined => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

export function isStaleDescriptionGrounding(
  entry: DescriptionGroundingRecheck | undefined,
  now: Date = new Date(),
): boolean {
  const checkedAt = asDate(entry?.checkedAt);
  if (!checkedAt) return true;
  return (
    now.getTime() - checkedAt.getTime() > DESCRIPTION_GROUNDING_STALE_DAYS * MILLISECONDS_PER_DAY
  );
}

const groundingRows = (value: unknown): DescriptionGroundingRecheck[] =>
  Array.isArray(value) ? (value.filter(Boolean) as DescriptionGroundingRecheck[]) : [];

export function descriptionGroundingEntry(
  entity: { descriptionGrounding?: unknown } | null | undefined,
  field: string,
  url: unknown,
): DescriptionGroundingRecheck | undefined {
  const key = typeof url === 'string' ? sourceLinkHealthKey(url) : null;
  if (!key) return undefined;
  return groundingRows(entity?.descriptionGrounding).find(
    (entry) => entry.field === field && sourceLinkHealthKey(String(entry.url || '')) === key,
  );
}

/**
 * Whether the row carries a fresh `UNSUPPORTED` verdict for a description field it serves.
 *
 * The gate reads this to decide whether it may still record
 * `source_backed_description`, which is the one signal that claims a source backs the
 * copy. A stale verdict does not count: the freshness horizon is what keeps a single
 * old probe from asserting a refusal forever, which is the repo's standing rule that a
 * probe verdict alone is not a durable refusal.
 */
export function servedDescriptionGroundingLost(
  entity: { descriptionGrounding?: unknown } | null | undefined,
  now: Date = new Date(),
): boolean {
  return groundingRows(entity?.descriptionGrounding).some(
    (entry) => entry.verdict === 'UNSUPPORTED' && !isStaleDescriptionGrounding(entry, now),
  );
}
