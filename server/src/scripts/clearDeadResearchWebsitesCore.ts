/**
 * Which served rows publish a research website the corpus positively knows is gone,
 * and which of them this pass may touch (#3309).
 *
 * A row's website is not a citation, so #3267's serve-time withhold is the wrong
 * instrument: `websiteUrl` is a gate input, and stripping a served field without a
 * re-gate leaves the row serving on a tier computed while it still had one. The value
 * is therefore cleared as stored data and the ordinary gate decides the tier.
 *
 * Fails closed four ways, and the first two are the ones that have cost rows before.
 * An operator lock on the field is never reversed, and the cleared field is never
 * frozen, because #3191 measured a repair that froze a cleared field whose value was
 * correct and withheld working research links. A url another row also owns is left
 * alone, because clearing a borrowed url promotes the borrower. And a row whose own
 * identity fields disagree about what it is gets handed to #3290 rather than repaired,
 * because a mis-aimed website is a symptom there rather than the defect.
 */
export type DeadWebsiteRefusal =
  | 'no-dead-website'
  | 'operator-locked'
  | 'url-owned-by-another-row'
  | 'entity-identity-is-in-question';

export interface DeadWebsiteRow {
  slug: string;
  entityType?: unknown;
  name?: unknown;
  displayName?: unknown;
  websiteUrl?: unknown;
  website?: unknown;
  manuallyLockedFields?: unknown;
}

export interface DeadWebsitePlan {
  slug: string;
  field: 'websiteUrl' | 'website';
  liveCitationsRemaining: number;
}

export interface DeadWebsiteOutcome {
  plans: DeadWebsitePlan[];
  refused: Array<{ slug: string; reason: DeadWebsiteRefusal }>;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function normalizeWebsiteUrl(url: unknown): string {
  return text(url)
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

const PERSON_SCOPED_TYPES = /^(?:FACULTY_RESEARCH_AREA|FACULTY_PROJECT|INDIVIDUAL_RESEARCH)$/;
const COLLECTIVE_NAME = /\b(?:lab|laboratory|center|centre|institute|program|programme)\b/i;

/**
 * Whether the row's own identity fields disagree about what it is, which is #3290's
 * shape rather than a website problem. Two independent signals: a name sharing no
 * token with the slug that addresses it, and a name claiming a collective on a
 * person-scoped type.
 */
export function entityIdentityIsInQuestion(row: DeadWebsiteRow): boolean {
  const name = text(row.name) || text(row.displayName);
  if (!name) return false;
  const nameTokens = name
    .toLowerCase()
    .replace(/[^a-z\s-]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2);
  const slugTokens = new Set(text(row.slug).split('-').filter(Boolean));
  const sharesNothing = nameTokens.length > 0 && !nameTokens.some((token) => slugTokens.has(token));
  const collectiveNameOnPersonType =
    COLLECTIVE_NAME.test(name) && PERSON_SCOPED_TYPES.test(text(row.entityType));
  return sharesNothing || collectiveNameOnPersonType;
}

export function planDeadResearchWebsiteClears(
  rows: readonly DeadWebsiteRow[],
  isDeadUrl: (row: DeadWebsiteRow, url: string) => boolean,
  liveCitationsFor: (row: DeadWebsiteRow) => number,
  ownerCountFor: (normalizedUrl: string) => number,
): DeadWebsiteOutcome {
  const plans: DeadWebsitePlan[] = [];
  const refused: Array<{ slug: string; reason: DeadWebsiteRefusal }> = [];

  for (const row of rows) {
    const slug = text(row.slug);
    const field: 'websiteUrl' | 'website' = text(row.websiteUrl) ? 'websiteUrl' : 'website';
    const url = text(row[field]);
    if (!url || !isDeadUrl(row, url)) {
      refused.push({ slug, reason: 'no-dead-website' });
      continue;
    }
    const locked = Array.isArray(row.manuallyLockedFields)
      ? row.manuallyLockedFields.map(text)
      : [];
    if (locked.includes('websiteUrl') || locked.includes('website')) {
      refused.push({ slug, reason: 'operator-locked' });
      continue;
    }
    if (ownerCountFor(normalizeWebsiteUrl(url)) > 1) {
      refused.push({ slug, reason: 'url-owned-by-another-row' });
      continue;
    }
    if (entityIdentityIsInQuestion(row)) {
      refused.push({ slug, reason: 'entity-identity-is-in-question' });
      continue;
    }
    plans.push({ slug, field, liveCitationsRemaining: liveCitationsFor(row) });
  }

  return { plans, refused };
}

export function summarizeDeadWebsiteRefusals(
  refused: ReadonlyArray<{ reason: DeadWebsiteRefusal }>,
): Record<DeadWebsiteRefusal, number> {
  const counts: Record<DeadWebsiteRefusal, number> = {
    'no-dead-website': 0,
    'operator-locked': 0,
    'url-owned-by-another-row': 0,
    'entity-identity-is-in-question': 0,
  };
  for (const row of refused) counts[row.reason] += 1;
  return counts;
}
