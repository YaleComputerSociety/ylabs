/**
 * The three rows the Development to Beta sync left serving a worse `websiteUrl`
 * than Production held (#2583). Promotion is a wholesale collection copy with no
 * per-field merge, so a newer environment can still regress an individual field:
 * that sync cleared 27 dead served `websiteUrl`s and introduced these 3 (#2574).
 *
 * The decision table is explicit rather than derived. Three rows do not share one
 * cause - two have a correct value Production already holds and the row already
 * cites, one has no live candidate at all - so a general rule inferred from them
 * would be fitted to n=3.
 */

import {
  classifySourceLinkHealth,
  isLikelyUnavailableSourceLink,
  sourceLinkHealthKey,
  type SourceLinkProbeResult,
} from '../services/sourceLinkHealth';
import { isDecisivelyLiveProbe } from './verifyOfficialProfileLinksCore';

export type WebsiteUrlRepairAction = 'restore' | 'clear';

export interface WebsiteUrlRepairDecision {
  slug: string;
  action: WebsiteUrlRepairAction;
  /** Required for `restore`: the value to write, which the row must already cite. */
  intendedWebsiteUrl?: string;
  /** The value the repair expects to replace, so a moved target is not clobbered. */
  expectedCurrentWebsiteUrl: string;
  why: string;
}

export const PROMOTION_REGRESSED_WEBSITE_URL_DECISIONS: readonly WebsiteUrlRepairDecision[] = [
  {
    slug: 'watts-dwatts',
    action: 'restore',
    intendedWebsiteUrl: 'https://anthropology.yale.edu/profile/david-watts',
    expectedCurrentWebsiteUrl: 'http://www.ngogochimp.commons.yale.edu/',
    why: "the stored host fails DNS; Production's value is already cited in this row's sourceUrls",
  },
  {
    slug: 'dept-physics-john-sous',
    action: 'restore',
    intendedWebsiteUrl: 'https://sous.yale.edu/profile/john-sous',
    expectedCurrentWebsiteUrl:
      'https://physics.yale.edu/academics/undergraduate-studies/undergraduate-research',
    why: 'the stored value is a departmental undergraduate-research page, a wrong-subject graft, and 404s',
  },
  {
    slug: 'ysm-faculty-shrikant-mane',
    action: 'clear',
    expectedCurrentWebsiteUrl: 'https://ycga.yale.edu/',
    why: 'no live candidate exists; Production holds the same dead value and withholds the row for description thinness, so there is nothing to restore',
  },
];

export interface WebsiteUrlRepairEntity {
  slug: string;
  websiteUrl?: unknown;
  sourceUrls?: unknown;
  manuallyLockedFields?: unknown;
}

export type WebsiteUrlRepairSkipReason =
  | 'entity_missing'
  | 'website_url_manually_locked'
  | 'current_value_unexpected'
  | 'intended_url_not_cited'
  | 'intended_url_not_reachable'
  | 'current_value_still_reachable'
  | 'probe_inconclusive'
  | 'write_conflict';

export interface WebsiteUrlRepairPlan {
  slug: string;
  action: WebsiteUrlRepairAction;
  currentWebsiteUrl?: string;
  nextWebsiteUrl?: string;
  nextManuallyLockedFields?: string[];
  requiresVisibilityRegate: boolean;
  skipped?: WebsiteUrlRepairSkipReason;
}

const asStringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

/**
 * Whether two URLs name the same destination once scheme, `www.`, host case, and a
 * trailing slash are folded. An unparseable URL matches nothing, including another
 * unparseable one: `sourceLinkHealthKey` reports both as `null`, and letting
 * `null === null` count as a citation would satisfy the "never mint a value the row
 * does not cite" guard on garbage rather than on evidence.
 */
export function isSameWebsiteUrlDestination(left: unknown, right: unknown): boolean {
  const leftKey = sourceLinkHealthKey(left);
  return leftKey !== null && leftKey === sourceLinkHealthKey(right);
}

/**
 * `websiteUrl` is re-derived from evidence on every materialization of a row
 * (`deriveResearchEntityWebsiteUrl`), and both restored values are person-profile
 * pages that the canonical resolver clears precisely because the row cites them.
 * A plain field write is therefore undone on the next scrape, and for a row whose
 * evidence still lists the dead value the resolver then promotes that value back.
 * Locking the field is what makes this per-row operator judgement durable, and it
 * is the same mechanism the materializer and the gate already honour.
 */
export const WEBSITE_URL_REPAIR_LOCK_FIELD = 'websiteUrl';

/** A live probe, narrowed to the three verdicts a repair may act on. */
export type WebsiteUrlProbeVerdict = 'live' | 'dead' | 'inconclusive';

/**
 * A raw status range is not a verdict. `classifySourceLinkHealth` calls a 2xx that
 * lands away from the requested resource UNAVAILABLE, which is exactly the shape a
 * retired Yale CMS profile takes, and it calls 403/429/5xx/timeout and the
 * `ERR_SSRF_BLOCKED` false positive (#2555) UNKNOWN rather than dead. Reusing it
 * keeps a soft-404 from licensing a restore and an inconclusive probe from
 * licensing a clear.
 */
export function websiteUrlProbeVerdict(probe: SourceLinkProbeResult): WebsiteUrlProbeVerdict {
  const health = classifySourceLinkHealth(probe);
  if (isDecisivelyLiveProbe(health)) return 'live';
  if (isLikelyUnavailableSourceLink(health)) return 'dead';
  return 'inconclusive';
}

/**
 * Decides one row, given its stored state and a freshly probed verdict for the URLs
 * involved. Fails closed in three directions: a restore is refused unless the
 * intended URL probes decisively live AND is already cited, a clear is refused
 * unless the value it would remove probes decisively dead, and an inconclusive
 * probe (throttle, outage, timeout, SSRF false positive) settles nothing either way.
 */
export function planWebsiteUrlRepair(
  decision: WebsiteUrlRepairDecision,
  entity: WebsiteUrlRepairEntity | undefined,
  probe: (url: string) => WebsiteUrlProbeVerdict,
): WebsiteUrlRepairPlan {
  const base: WebsiteUrlRepairPlan = {
    slug: decision.slug,
    action: decision.action,
    requiresVisibilityRegate: false,
  };
  if (!entity) return { ...base, skipped: 'entity_missing' };

  const currentWebsiteUrl =
    typeof entity.websiteUrl === 'string' ? entity.websiteUrl.trim() : undefined;
  const locked = asStringList(entity.manuallyLockedFields);
  const withCurrent = { ...base, currentWebsiteUrl };

  if (locked.includes(WEBSITE_URL_REPAIR_LOCK_FIELD)) {
    return { ...withCurrent, skipped: 'website_url_manually_locked' };
  }
  if (!isSameWebsiteUrlDestination(currentWebsiteUrl, decision.expectedCurrentWebsiteUrl)) {
    return { ...withCurrent, skipped: 'current_value_unexpected' };
  }
  const nextManuallyLockedFields = [...locked, WEBSITE_URL_REPAIR_LOCK_FIELD];

  if (decision.action === 'clear') {
    const verdict = probe(decision.expectedCurrentWebsiteUrl);
    if (verdict === 'live') {
      return { ...withCurrent, skipped: 'current_value_still_reachable' };
    }
    if (verdict !== 'dead') return { ...withCurrent, skipped: 'probe_inconclusive' };
    return {
      ...withCurrent,
      nextWebsiteUrl: '',
      nextManuallyLockedFields,
      requiresVisibilityRegate: true,
    };
  }

  const intended = decision.intendedWebsiteUrl;
  if (!intended) return { ...withCurrent, skipped: 'intended_url_not_reachable' };
  if (!asStringList(entity.sourceUrls).some((url) => isSameWebsiteUrlDestination(url, intended))) {
    return { ...withCurrent, skipped: 'intended_url_not_cited' };
  }
  const verdict = probe(intended);
  if (verdict === 'dead') return { ...withCurrent, skipped: 'intended_url_not_reachable' };
  if (verdict !== 'live') return { ...withCurrent, skipped: 'probe_inconclusive' };
  return {
    ...withCurrent,
    nextWebsiteUrl: intended,
    nextManuallyLockedFields,
    requiresVisibilityRegate: false,
  };
}

export interface WebsiteUrlRepairSummary {
  planned: number;
  restored: number;
  cleared: number;
  skipped: number;
  skipReasons: Record<string, number>;
  regateSlugs: string[];
}

export function summarizeWebsiteUrlRepairPlans(
  plans: readonly WebsiteUrlRepairPlan[],
): WebsiteUrlRepairSummary {
  const skipReasons: Record<string, number> = {};
  let restored = 0;
  let cleared = 0;
  let skipped = 0;
  for (const plan of plans) {
    if (plan.skipped) {
      skipped += 1;
      skipReasons[plan.skipped] = (skipReasons[plan.skipped] ?? 0) + 1;
      continue;
    }
    if (plan.action === 'clear') cleared += 1;
    else restored += 1;
  }
  return {
    planned: restored + cleared,
    restored,
    cleared,
    skipped,
    skipReasons,
    regateSlugs: plans
      .filter((plan) => !plan.skipped && plan.requiresVisibilityRegate)
      .map((plan) => plan.slug),
  };
}
