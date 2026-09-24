import {
  resolveResearchDetailActionLinkContext,
  resolveResearchDetailActionLinks,
} from '../utils/researchDetailActionLinks';
import {
  isSameActionDestination,
  normalizeActionDestination,
} from '../utils/researchDetailSources';

/**
 * Stage two of `research-entity:audit-duplicate-action-links` (#3207, #3288).
 *
 * Applies the page's own resolver to the payloads stage one dumped. It composes
 * nothing: `resolveResearchDetailActionLinkContext` is the same function the detail
 * page calls, so a change to the outreach chain or the lead dedupe moves this audit
 * and the page together. That single-decision property is the reason the audit exists
 * at all; the previous measurement had to transcribe two unexported helpers.
 */
export interface ActionLinkAuditPayload {
  slug: string;
  group: unknown;
  members: unknown;
  accessSignals?: unknown;
}

export interface ActionLinkAuditReport {
  rowsRead: number;
  /** Rows where both slots resolve to a link. The control population. */
  bothLinks: number;
  /** Rows where the two slots resolve to one destination. The #3207 defect lane. */
  oneDestination: number;
  /** Rows whose slots share a host and person slug yet still compare as distinct. */
  sharedPersonSlugStillDistinct: number;
  /** Rows carrying more than one stored citation for a single person page. */
  redundantPersonPageCitations: number;
  cohortPrefixes: string[];
}

const personSlugKey = (url?: string): string | null => {
  const normalized = normalizeActionDestination(url);
  if (!normalized) return null;
  const [host, ...rest] = normalized.split('/');
  const leaf = rest.filter(Boolean).pop();
  return host && leaf ? `${host}\u0000${leaf}` : null;
};

const cohortPrefix = (url?: string): string | null => {
  const normalized = normalizeActionDestination(url);
  const match = normalized?.match(/\/people\/([^/]+)\//);
  return match ? match[1] : null;
};

export function auditDuplicateActionLinks(
  payloads: readonly ActionLinkAuditPayload[],
): ActionLinkAuditReport {
  let bothLinks = 0;
  let oneDestination = 0;
  let sharedPersonSlugStillDistinct = 0;
  let redundantPersonPageCitations = 0;
  const cohortPrefixes = new Set<string>();

  for (const payload of payloads) {
    const context = resolveResearchDetailActionLinkContext({
      group: payload.group as never,
      members: (payload.members || []) as never,
      accessSignals: (payload.accessSignals || []) as never,
    });
    const links = resolveResearchDetailActionLinks(context);
    if (!links.offersBothLinks) continue;
    bothLinks += 1;
    if (links.slotsShareOneDestination) {
      oneDestination += 1;
      continue;
    }
    const profileKey = personSlugKey(links.leadCardProfileUrl);
    const websiteKey = personSlugKey(context.websiteUrl);
    if (profileKey && profileKey === websiteKey) {
      sharedPersonSlugStillDistinct += 1;
      for (const url of [links.leadCardProfileUrl, context.websiteUrl]) {
        const prefix = cohortPrefix(url);
        if (prefix) cohortPrefixes.add(prefix);
      }
    }
    const citations = ((payload.group as { sourceUrls?: unknown })?.sourceUrls || []) as string[];
    const perPerson = new Map<string, number>();
    for (const citation of citations) {
      const key = personSlugKey(citation);
      if (key) perPerson.set(key, (perPerson.get(key) || 0) + 1);
    }
    if ([...perPerson.values()].some((count) => count > 1)) redundantPersonPageCitations += 1;
  }

  return {
    rowsRead: payloads.length,
    bothLinks,
    oneDestination,
    sharedPersonSlugStillDistinct,
    redundantPersonPageCitations,
    cohortPrefixes: [...cohortPrefixes].sort(),
  };
}

/** Exported so the audit's own test can prove the comparison is load-bearing. */
export const auditSamenessProbe = isSameActionDestination;
