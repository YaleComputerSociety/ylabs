import { citationDestination, personPageMirrorKey } from './auditPersonPageCitationMirrorsCore';

export interface CitationMirrorHealthEntry {
  url?: string;
  healthStatus?: string;
  httpStatusCode?: number;
  checkedAt?: unknown;
  privateAddressHost?: boolean;
  [key: string]: unknown;
}

export interface CitationMirrorProvenanceEntry {
  sourceUrl?: string;
  [key: string]: unknown;
}

export interface CitationMirrorRow {
  _id?: unknown;
  slug?: string;
  sourceUrls?: unknown;
  sourceLinkHealth?: unknown;
  fieldProvenance?: Record<string, unknown>;
  studentDecisionExplanation?: { sourceUrls?: unknown; [key: string]: unknown };
}

export interface CitationMirrorPlan {
  slug: string;
  /** Cited destination kept per mirror group, and the destinations folded into it. */
  groups: Array<{ host: string; keptPath: string; droppedPaths: string[]; keptBecause: string }>;
  sourceUrls?: string[];
  sourceLinkHealth?: CitationMirrorHealthEntry[];
  fieldProvenanceRepoints: Array<{
    field: string;
    fromPath: string;
    toPath: string;
    toUrl: string;
  }>;
  decisionSourceUrls?: string[];
  carriedHealthForward: number;
  healthEntriesRemoved: number;
}

/**
 * Health rank for choosing which spelling of one person page to keep.
 *
 * Not canonicality first. 50 mirror groups record one spelling HEALTHY and the other
 * UNAVAILABLE, because a department retires the old cohort path when it renames the
 * segment, so choosing the prettier URL would have kept a dead page on those rows.
 */
const HEALTH_RANK: Record<string, number> = {
  HEALTHY: 0,
  UNKNOWN: 1,
  UNAVAILABLE: 2,
};

const healthRank = (status: string | undefined): number =>
  status && status in HEALTH_RANK ? HEALTH_RANK[status] : 1;

const pathSegmentCount = (url: string): number => {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
};

const isMoreCanonical = (candidate: string, current: string): boolean => {
  const candidateIsHttps = candidate.startsWith('https://');
  const currentIsHttps = current.startsWith('https://');
  if (candidateIsHttps !== currentIsHttps) return candidateIsHttps;
  return pathSegmentCount(candidate) < pathSegmentCount(current);
};

const stringArray = (value: unknown): string[] =>
  (Array.isArray(value) ? value : []).filter(
    (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
  );

const healthEntries = (value: unknown): CitationMirrorHealthEntry[] =>
  (Array.isArray(value) ? value : []).filter(
    (entry): entry is CitationMirrorHealthEntry =>
      Boolean(entry) &&
      typeof entry === 'object' &&
      typeof (entry as never as { url: unknown }).url === 'string',
  );

const pathOf = (destination: string): string => destination.slice(destination.indexOf('/'));

/**
 * Collapse every group of cited URLs that are one person's page reached by different
 * paths, keeping one spelling and re-pointing everything that named a dropped one.
 *
 * Deliberately narrow: a URL is only touched when its mirror key matches a spelling the
 * row still cites, which is what proves the two are one page and makes the rewrite
 * lossless. A `sourceLinkHealth` or `fieldProvenance` entry naming a URL whose person page
 * is cited nowhere on the row is a far larger backlog with a different question behind it -
 * is a health record for a removed citation garbage, or history - and answering that here
 * would hide it inside a dedupe.
 */
export const planCitationMirrorCollapse = (row: CitationMirrorRow): CitationMirrorPlan | null => {
  const slug = String(row.slug || '');
  const urls = stringArray(row.sourceUrls);
  const health = healthEntries(row.sourceLinkHealth);

  const healthByDestination = new Map<string, CitationMirrorHealthEntry>();
  health.forEach((entry) => {
    const destination = citationDestination(entry.url as string);
    if (destination && !healthByDestination.has(destination)) {
      healthByDestination.set(destination, entry);
    }
  });

  const byMirrorKey = new Map<string, string[]>();
  urls.forEach((url) => {
    const key = personPageMirrorKey(url);
    if (!key) return;
    const bucket = byMirrorKey.get(key);
    if (bucket) bucket.push(url);
    else byMirrorKey.set(key, [url]);
  });

  const droppedToKept = new Map<string, string>();
  const groups: CitationMirrorPlan['groups'] = [];

  for (const candidates of byMirrorKey.values()) {
    const byDestination = new Map<string, string>();
    candidates.forEach((url) => {
      const destination = citationDestination(url);
      if (destination && !byDestination.has(destination)) byDestination.set(destination, url);
    });
    if (byDestination.size < 2) continue;

    let keptDestination = '';
    let keptUrl = '';
    let keptReason = '';
    for (const [destination, url] of byDestination) {
      if (!keptDestination) {
        keptDestination = destination;
        keptUrl = url;
        keptReason = 'first';
        continue;
      }
      const candidateRank = healthRank(healthByDestination.get(destination)?.healthStatus);
      const keptRankValue = healthRank(healthByDestination.get(keptDestination)?.healthStatus);
      if (candidateRank !== keptRankValue) {
        if (candidateRank < keptRankValue) {
          keptDestination = destination;
          keptUrl = url;
          keptReason = 'healthier';
        }
        continue;
      }
      if (isMoreCanonical(url, keptUrl)) {
        keptDestination = destination;
        keptUrl = url;
        keptReason = 'more canonical';
      }
    }

    const dropped = [...byDestination.keys()].filter(
      (destination) => destination !== keptDestination,
    );
    dropped.forEach((destination) => droppedToKept.set(destination, keptDestination));
    groups.push({
      host: keptDestination.split('/')[0],
      keptPath: pathOf(keptDestination),
      droppedPaths: dropped.map(pathOf),
      keptBecause:
        healthRank(healthByDestination.get(keptDestination)?.healthStatus) <
        Math.min(
          ...dropped.map((destination) =>
            healthRank(healthByDestination.get(destination)?.healthStatus),
          ),
        )
          ? 'healthier'
          : keptReason,
    });
  }

  /**
   * A pointer left naming a spelling the row no longer cites, while it still cites another
   * spelling of the same person page, is the residue a materialize pass leaves behind when
   * it rewrites `sourceUrls` from fresh observations: the citation list heals itself and
   * `fieldProvenance`, `sourceLinkHealth` and the decision card keep naming the retired
   * path. It outnumbers the surviving duplicates by 317 rows to 15, so planning only on a
   * duplicate would have repaired the smaller half and called the issue done.
   *
   * Repointing these loses nothing, because the mirror key proves the two spellings are one
   * page and the target is a URL the row still cites. A pointer at a URL whose person page
   * is cited nowhere is a different and larger question, and is left alone.
   */
  const keptCitedByKey = new Map<string, string>();
  urls.forEach((url) => {
    const key = personPageMirrorKey(url);
    const destination = citationDestination(url);
    if (!key || !destination) return;
    if (droppedToKept.has(destination)) return;
    if (!keptCitedByKey.has(key)) keptCitedByKey.set(key, destination);
  });

  const citedDestinations = new Set(
    urls
      .map((url) => citationDestination(url))
      .filter((destination): destination is string => Boolean(destination)),
  );

  const registerResidue = (url: unknown): void => {
    if (typeof url !== 'string') return;
    const destination = citationDestination(url);
    const key = personPageMirrorKey(url);
    if (!destination || !key) return;
    if (citedDestinations.has(destination)) return;
    const keptFor = keptCitedByKey.get(key);
    if (!keptFor || keptFor === destination) return;
    droppedToKept.set(destination, keptFor);
  };

  Object.values(row.fieldProvenance || {}).forEach((value) =>
    registerResidue((value as CitationMirrorProvenanceEntry | null)?.sourceUrl),
  );
  health.forEach((entry) => registerResidue(entry.url));
  stringArray(row.studentDecisionExplanation?.sourceUrls).forEach(registerResidue);

  if (groups.length === 0 && droppedToKept.size === 0) return null;

  const seenSourceUrl = new Set<string>();
  const nextSourceUrls = urls.filter((url) => {
    const destination = citationDestination(url);
    if (!destination) return true;
    if (droppedToKept.has(destination)) return false;
    if (seenSourceUrl.has(destination)) return false;
    seenSourceUrl.add(destination);
    return true;
  });

  /**
   * A dropped spelling sometimes carries the only recorded health for the page (23 groups).
   * Its status is carried onto the retained spelling so the probe is not lost, except when
   * it says UNAVAILABLE: that verdict belonged to the retired path, and restating it about
   * the page we keep would assert something no probe established.
   */
  let carriedHealthForward = 0;
  const nextHealth: CitationMirrorHealthEntry[] = [];
  const seenHealthDestination = new Set<string>();
  for (const entry of health) {
    const destination = citationDestination(entry.url as string);
    if (!destination) {
      nextHealth.push(entry);
      continue;
    }
    const keptFor = droppedToKept.get(destination);
    if (!keptFor) {
      if (seenHealthDestination.has(destination)) continue;
      seenHealthDestination.add(destination);
      nextHealth.push(entry);
      continue;
    }
    if (healthByDestination.has(keptFor)) continue;
    if (String(entry.healthStatus) === 'UNAVAILABLE') continue;
    if (seenHealthDestination.has(keptFor)) continue;
    const keptUrl = nextSourceUrls.find((url) => citationDestination(url) === keptFor);
    if (!keptUrl) continue;
    seenHealthDestination.add(keptFor);
    carriedHealthForward += 1;
    nextHealth.push({ ...entry, url: keptUrl });
  }

  const keptUrlByDestination = new Map<string, string>();
  nextSourceUrls.forEach((url) => {
    const destination = citationDestination(url);
    if (destination && !keptUrlByDestination.has(destination)) {
      keptUrlByDestination.set(destination, url);
    }
  });

  const fieldProvenanceRepoints: CitationMirrorPlan['fieldProvenanceRepoints'] = [];
  for (const [field, value] of Object.entries(row.fieldProvenance || {})) {
    const sourceUrl = (value as CitationMirrorProvenanceEntry | null)?.sourceUrl;
    if (typeof sourceUrl !== 'string') continue;
    const destination = citationDestination(sourceUrl);
    if (!destination) continue;
    const keptFor = droppedToKept.get(destination);
    if (!keptFor) continue;
    const keptUrl = keptUrlByDestination.get(keptFor);
    if (!keptUrl) continue;
    fieldProvenanceRepoints.push({
      field,
      fromPath: pathOf(destination),
      toPath: pathOf(keptFor),
      toUrl: keptUrl,
    });
  }

  const decisionUrls = stringArray(row.studentDecisionExplanation?.sourceUrls);
  let decisionChanged = false;
  const seenDecision = new Set<string>();
  const nextDecisionUrls: string[] = [];
  for (const url of decisionUrls) {
    const destination = citationDestination(url);
    if (!destination) {
      nextDecisionUrls.push(url);
      continue;
    }
    const keptFor = droppedToKept.get(destination);
    const target = keptFor ? keptUrlByDestination.get(keptFor) : url;
    if (!target) {
      decisionChanged = true;
      continue;
    }
    if (keptFor) decisionChanged = true;
    const targetDestination = citationDestination(target)!;
    if (seenDecision.has(targetDestination)) {
      decisionChanged = true;
      continue;
    }
    seenDecision.add(targetDestination);
    nextDecisionUrls.push(target);
  }

  const healthEntriesRemoved = Math.max(0, health.length - nextHealth.length);
  const sourceUrlsChanged = nextSourceUrls.length !== urls.length;
  const healthChanged =
    nextHealth.length !== health.length ||
    nextHealth.some((entry, index) => entry.url !== health[index]?.url);

  return {
    slug,
    groups,
    ...(sourceUrlsChanged ? { sourceUrls: nextSourceUrls } : {}),
    ...(healthChanged ? { sourceLinkHealth: nextHealth } : {}),
    fieldProvenanceRepoints,
    ...(decisionChanged ? { decisionSourceUrls: nextDecisionUrls } : {}),
    carriedHealthForward,
    healthEntriesRemoved,
  } satisfies CitationMirrorPlan;
};

export interface CitationMirrorCollapseSummary {
  rowsRead: number;
  rowsPlanned: number;
  groupsCollapsed: number;
  rowsRepointedOnly: number;
  citationsDropped: number;
  keptBecauseHealthier: number;
  healthEntriesRemoved: number;
  healthCarriedForward: number;
  provenanceRepointed: number;
  decisionSourceListsRewritten: number;
}

export const summarizeCitationMirrorPlans = (
  plans: CitationMirrorPlan[],
  rowsRead: number,
): CitationMirrorCollapseSummary => ({
  rowsRead,
  rowsPlanned: plans.length,
  groupsCollapsed: plans.reduce((total, plan) => total + plan.groups.length, 0),
  rowsRepointedOnly: plans.filter((plan) => plan.groups.length === 0).length,
  citationsDropped: plans.reduce(
    (total, plan) => total + plan.groups.reduce((sum, group) => sum + group.droppedPaths.length, 0),
    0,
  ),
  keptBecauseHealthier: plans.reduce(
    (total, plan) =>
      total + plan.groups.filter((group) => group.keptBecause === 'healthier').length,
    0,
  ),
  healthEntriesRemoved: plans.reduce((total, plan) => total + plan.healthEntriesRemoved, 0),
  healthCarriedForward: plans.reduce((total, plan) => total + plan.carriedHealthForward, 0),
  provenanceRepointed: plans.reduce(
    (total, plan) => total + plan.fieldProvenanceRepoints.length,
    0,
  ),
  decisionSourceListsRewritten: plans.filter((plan) => plan.decisionSourceUrls).length,
});
