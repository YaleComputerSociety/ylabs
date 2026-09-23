import { isDescriptionGroundedInSource } from '../utils/officialResearchDescription';
import {
  type SourceLinkHealth,
  isLikelyUnavailableSourceLink,
  sourceLinkHealthKey,
} from './sourceLinkHealth';

/**
 * Whether a stored description still appears on the page it cites.
 *
 * Four verdicts rather than a boolean, for the reason `classifySourceLinkHealth`
 * already encodes and that this issue's first measurement fell into: a probe run at
 * 12-way concurrency with a non-browser user agent read 1,520 of 2,922 cited pages
 * as 403 and the grounding check then ran against a block page, which reported ~0
 * groundings on a cohort whose pages were live. Only 13 of those URLs were genuinely
 * gone. A verdict vocabulary that cannot say "I could not tell" turns a throttle into
 * a retraction (#2879).
 *
 * - `GROUNDED`   the page was fetched and still carries the description.
 * - `ABSENT`     the page was fetched and no longer carries it. The only verdict a
 *                repair may ever act on, and it requires a 2xx body.
 * - `UNREACHABLE` the page asserts it is gone (404/410). Says nothing about the prose.
 * - `UNKNOWN`    anything else: a throttle, a WAF, a timeout, a private-address host,
 *                a redirect we did not follow to a body. Never an assertion.
 */
export const descriptionGroundingVerdicts = [
  'GROUNDED',
  'ABSENT',
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
  storedDescription: unknown;
}

/**
 * The verdict for one (description, cited page) pair.
 *
 * Fails closed to `UNKNOWN` whenever there is no 2xx body to compare against, so no
 * transport outcome can produce `ABSENT`. `UNAVAILABLE` link health is reported as
 * `UNREACHABLE` rather than folded into `UNKNOWN` because a page that asserts it is
 * gone is a durable fact worth keeping apart from a bad afternoon.
 */
export function classifyDescriptionGrounding(
  input: DescriptionGroundingInput,
): DescriptionGroundingVerdict {
  const { linkHealth, pageText, storedDescription } = input;
  if (linkHealth.privateAddressHost) return 'UNKNOWN';
  if (isLikelyUnavailableSourceLink(linkHealth)) return 'UNREACHABLE';
  if (typeof pageText !== 'string' || !pageText.trim()) return 'UNKNOWN';
  if (typeof storedDescription !== 'string' || !storedDescription.trim()) return 'UNKNOWN';
  return isDescriptionGroundedInSource(storedDescription, pageText) ? 'GROUNDED' : 'ABSENT';
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
 * Whether the row carries a fresh `ABSENT` verdict for a description field it serves.
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
    (entry) => entry.verdict === 'ABSENT' && !isStaleDescriptionGrounding(entry, now),
  );
}
