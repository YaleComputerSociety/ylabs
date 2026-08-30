import type { ResearcherProfileLink } from '../models/researcher';
import {
  isYaleOfficialProfileUrl,
  supersedesOfficialProfileUrl,
} from './backfillResearcherOfficialProfileLinksCore';

export interface SupersededOfficialProfileLinkFacts {
  id: string;
  displayName?: string;
  profileLinks?: unknown;
}

export interface SupersededOfficialProfileLinkPlanRow {
  id: string;
  displayName?: string;
  before: string;
  after: string;
}

const profileLinkList = (value: unknown): ResearcherProfileLink[] =>
  Array.isArray(value) ? (value as ResearcherProfileLink[]) : [];

const cmsProfileTwinUrl = (url: string): string | undefined => {
  if (!isYaleOfficialProfileUrl(url)) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const slug = parsed.pathname.replace(/\/+$/, '').split('/').pop();
  if (!slug) return undefined;
  return `https://${parsed.hostname.toLowerCase()}/profile/${slug.toLowerCase()}`;
};

/**
 * Canonical form for comparing an observed profile URL against a stored link's
 * candidate twin: host and path only, lower-cased, without a trailing slash.
 */
export function canonicalOfficialProfileUrlKey(value: unknown): string | undefined {
  if (!isYaleOfficialProfileUrl(value)) return undefined;
  try {
    const url = new URL(String(value).trim());
    return `https://${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, '').toLowerCase()}`;
  } catch {
    return undefined;
  }
}

/**
 * A stale link is only repaired when the department site itself was observed
 * publishing the same person's slug under its canonical `/profile/` page, so the
 * replacement stays evidence-backed rather than a rewritten guess.
 */
export function planSupersededOfficialProfileLinkRepair(
  facts: SupersededOfficialProfileLinkFacts,
  observedProfileUrlKeys: ReadonlySet<string>,
): SupersededOfficialProfileLinkPlanRow | undefined {
  for (const link of profileLinkList(facts.profileLinks)) {
    if (link?.kind !== 'YALE_OFFICIAL') continue;
    const twin = cmsProfileTwinUrl(String(link.url || ''));
    if (!twin) continue;
    if (!observedProfileUrlKeys.has(twin)) continue;
    if (!supersedesOfficialProfileUrl(link.url, twin)) continue;
    return {
      id: facts.id,
      displayName: facts.displayName,
      before: String(link.url),
      after: twin,
    };
  }
  return undefined;
}

export interface SupersededOfficialProfileLinkSummary {
  considered: number;
  repairable: number;
}

export function summarizeSupersededOfficialProfileLinkRepair(
  considered: number,
  rows: SupersededOfficialProfileLinkPlanRow[],
): SupersededOfficialProfileLinkSummary {
  return { considered, repairable: rows.length };
}
