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

/**
 * Canonical form for de-duplicating observed profile URLs: host and path only,
 * lower-cased, without a trailing slash. Only ever a comparison key - never the
 * value written back, because Yale's web servers treat paths as case-sensitive.
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
 * `user` observations are anchored by netid, either bare or `netid:`-prefixed
 * depending on the scraper, so both forms have to fold to one token before
 * observed evidence can be matched to the researcher it belongs to. A key that
 * is not netid-shaped (a roster slug such as `ysm:some-slug`) simply never
 * matches a researcher, which keeps unattributable evidence out of the repair.
 */
export function officialProfileEvidenceKey(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const netid = value
    .trim()
    .toLowerCase()
    .replace(/^netid:/, '')
    .trim();
  return netid || undefined;
}

/**
 * A stale link is only repaired when this same researcher's own observations
 * recorded the department publishing them on its canonical profile page, and the
 * replacement is that observed URL verbatim, so the repair stays evidence-backed
 * rather than a rewritten guess that could 404 the same way.
 */
export function planSupersededOfficialProfileLinkRepair(
  facts: SupersededOfficialProfileLinkFacts,
  observedOfficialProfileUrls: readonly string[],
): SupersededOfficialProfileLinkPlanRow | undefined {
  for (const link of profileLinkList(facts.profileLinks)) {
    if (link?.kind !== 'YALE_OFFICIAL') continue;
    const before = String(link.url || '');
    const after = observedOfficialProfileUrls.find((observed) =>
      supersedesOfficialProfileUrl(before, observed),
    );
    if (!after) continue;
    return {
      id: facts.id,
      displayName: facts.displayName,
      before,
      after,
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
