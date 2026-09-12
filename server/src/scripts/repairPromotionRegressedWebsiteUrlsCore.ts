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
  | 'current_value_still_reachable';

export interface WebsiteUrlRepairPlan {
  slug: string;
  action: WebsiteUrlRepairAction;
  currentWebsiteUrl?: string;
  nextWebsiteUrl?: string;
  requiresVisibilityRegate: boolean;
  skipped?: WebsiteUrlRepairSkipReason;
}

const asStringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

/**
 * Cosmetic differences a citation check must ignore. Mirrors `sourceLinkHealthKey`
 * so a value cited under one spelling is recognised under the other; a repair that
 * missed the match would refuse a correct restore as uncited.
 */
export function websiteUrlCitationKey(url: unknown): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    const routePath = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${host}${routePath}${parsed.search}`;
  } catch {
    return null;
  }
}

export interface WebsiteUrlReachability {
  /** 2xx or 3xx at probe time. A repair trusts this, never a stored verdict. */
  reachable: boolean;
}

/**
 * Decides one row, given its stored state and a freshly probed reachability for
 * the URLs involved. Fails closed in both directions: a restore is refused unless
 * the intended URL is reachable AND already cited, and a clear is refused if the
 * value it would remove turns out to still resolve.
 */
export function planWebsiteUrlRepair(
  decision: WebsiteUrlRepairDecision,
  entity: WebsiteUrlRepairEntity | undefined,
  probe: (url: string) => WebsiteUrlReachability | undefined,
): WebsiteUrlRepairPlan {
  const base: WebsiteUrlRepairPlan = {
    slug: decision.slug,
    action: decision.action,
    requiresVisibilityRegate: false,
  };
  if (!entity) return { ...base, skipped: 'entity_missing' };

  const currentWebsiteUrl =
    typeof entity.websiteUrl === 'string' ? entity.websiteUrl.trim() : undefined;
  const withCurrent = { ...base, currentWebsiteUrl };

  if (asStringList(entity.manuallyLockedFields).includes('websiteUrl')) {
    return { ...withCurrent, skipped: 'website_url_manually_locked' };
  }
  if (
    websiteUrlCitationKey(currentWebsiteUrl) !==
    websiteUrlCitationKey(decision.expectedCurrentWebsiteUrl)
  ) {
    return { ...withCurrent, skipped: 'current_value_unexpected' };
  }

  if (decision.action === 'clear') {
    if (probe(decision.expectedCurrentWebsiteUrl)?.reachable) {
      return { ...withCurrent, skipped: 'current_value_still_reachable' };
    }
    return { ...withCurrent, nextWebsiteUrl: '', requiresVisibilityRegate: true };
  }

  const intended = decision.intendedWebsiteUrl;
  if (!intended) return { ...withCurrent, skipped: 'intended_url_not_reachable' };
  const citedKeys = new Set(asStringList(entity.sourceUrls).map((url) => websiteUrlCitationKey(url)));
  if (!citedKeys.has(websiteUrlCitationKey(intended))) {
    return { ...withCurrent, skipped: 'intended_url_not_cited' };
  }
  if (!probe(intended)?.reachable) {
    return { ...withCurrent, skipped: 'intended_url_not_reachable' };
  }
  return { ...withCurrent, nextWebsiteUrl: intended, requiresVisibilityRegate: false };
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
    regateSlugs: plans.filter((plan) => !plan.skipped && plan.requiresVisibilityRegate).map((plan) => plan.slug),
  };
}
