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
import { planFieldValueRefusal, valueIsRefused } from '../utils/researchEntityFieldValueRefusals';
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
  fieldValueRefusals?: unknown;
}

export type WebsiteUrlRepairSkipReason =
  | 'entity_missing'
  | 'website_url_manually_locked'
  | 'website_url_value_already_refused'
  | 'current_value_unexpected'
  | 'intended_url_not_cited'
  | 'intended_url_not_reachable'
  | 'current_value_still_reachable'
  | 'probe_inconclusive'
  | 'lock_declaration_missing'
  | 'write_conflict';

export interface WebsiteUrlRepairPlan {
  slug: string;
  action: WebsiteUrlRepairAction;
  currentWebsiteUrl?: string;
  nextWebsiteUrl?: string;
  /**
   * The `$set` fragment that refuses the REGRESSED value at `websiteUrl` and records
   * why, from `planFieldValueRefusal`. One value rather than a bare field name, so the
   * rule and the reason cannot be dropped on the way to the write or omitted from the
   * report.
   */
  nextFieldValueRefusalUpdate?: Record<string, unknown>;
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
 *
 * What forced the lock was "the engine's inability to be told a cited value is wrong",
 * and `fieldValueRefusals` is exactly that capability, so the durability now comes from
 * refusing the REGRESSED value rather than from freezing the field. That is strictly
 * better and not merely equivalent: a lock removed `websiteUrl` from derivation for good,
 * so the row could never take a better research home, and the lane was blinded by its own
 * locks - measured 0 planned with all 3 of its rows skipped as
 * `website_url_manually_locked`. A refusal names one value, survives re-observation
 * because it is keyed on the value, and can be withdrawn with a reason.
 *
 * The rule differs by arm, because the evidence does. A `restore` refuses the regressed
 * value as `superseded_by_better_source`, which is what the intended cited URL is. A
 * `clear` records `operator_judgement` with the link-health verdict in the note, and
 * deliberately NOT `confirmed_dead_page`: that rule means an explicit 404 or 410, while
 * this lane's `dead` comes from `isLikelyUnavailableSourceLink` over stored
 * `sourceLinkHealth`, so claiming it would overstate the evidence.
 */
export const WEBSITE_URL_REPAIR_FIELD = 'websiteUrl';

export const WEBSITE_URL_REPAIR_REFUSED_BY = 'repair-promotion-regressed-website-urls';

export const WEBSITE_URL_REPAIR_REFUSAL_NOTE =
  'websiteUrl is re-derived from evidence the row still cites, so a plain write is undone on the next scrape; refusing the regressed VALUE holds without freezing the field, so the row can still take a better research home (#2542, #3167).';

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

  if (locked.includes(WEBSITE_URL_REPAIR_FIELD)) {
    return { ...withCurrent, skipped: 'website_url_manually_locked' };
  }
  if (!isSameWebsiteUrlDestination(currentWebsiteUrl, decision.expectedCurrentWebsiteUrl)) {
    return { ...withCurrent, skipped: 'current_value_unexpected' };
  }
  if (valueIsRefused(entity.fieldValueRefusals, WEBSITE_URL_REPAIR_FIELD, currentWebsiteUrl)) {
    return { ...withCurrent, skipped: 'website_url_value_already_refused' };
  }
  const refusalUpdateFor = (
    rule: 'superseded_by_better_source' | 'operator_judgement',
    note: string,
    evidenceUrl?: string,
  ): Record<string, unknown> =>
    planFieldValueRefusal(entity.fieldValueRefusals, {
      field: WEBSITE_URL_REPAIR_FIELD,
      value: decision.expectedCurrentWebsiteUrl,
      rule,
      refusedBy: WEBSITE_URL_REPAIR_REFUSED_BY,
      note,
      ...(evidenceUrl ? { evidenceUrl } : {}),
    });

  if (decision.action === 'clear') {
    const verdict = probe(decision.expectedCurrentWebsiteUrl);
    if (verdict === 'live') {
      return { ...withCurrent, skipped: 'current_value_still_reachable' };
    }
    if (verdict !== 'dead') return { ...withCurrent, skipped: 'probe_inconclusive' };
    return {
      ...withCurrent,
      nextWebsiteUrl: '',
      nextFieldValueRefusalUpdate: refusalUpdateFor(
        'operator_judgement',
        `${WEBSITE_URL_REPAIR_REFUSAL_NOTE} The value probed unavailable through stored sourceLinkHealth rather than through an explicit 404 or 410, which is why this is not recorded as confirmed_dead_page.`,
      ),
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
    nextFieldValueRefusalUpdate: refusalUpdateFor(
      'superseded_by_better_source',
      WEBSITE_URL_REPAIR_REFUSAL_NOTE,
      intended,
    ),
    requiresVisibilityRegate: false,
  };
}

/**
 * The update document for a planned row, or nothing when the plan carries a value
 * to write but no record of why it locks the field. Writing one half without the
 * other is the failure this repair must not produce: an unlocked write is undone by
 * the next materialization, and an unattributed lock is the frozen row #2612 exists
 * to stop being minted.
 *
 * The stale `fieldProvenance.websiteUrl` names the observation behind the value
 * being replaced, and this repair cannot name one for the value it writes, so that
 * assertion is dropped on both arms.
 */
export function planWebsiteUrlRepairUpdate(
  plan: WebsiteUrlRepairPlan,
): Record<string, unknown> | undefined {
  if (plan.skipped || plan.nextWebsiteUrl === undefined || !plan.nextFieldValueRefusalUpdate) {
    return undefined;
  }
  if (plan.nextWebsiteUrl === '') {
    return {
      $set: plan.nextFieldValueRefusalUpdate,
      $unset: { websiteUrl: '', 'fieldProvenance.websiteUrl': '' },
    };
  }
  return {
    $set: { websiteUrl: plan.nextWebsiteUrl, ...plan.nextFieldValueRefusalUpdate },
    $unset: { 'fieldProvenance.websiteUrl': '' },
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
