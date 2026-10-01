import type { StudentVisibilityTier } from '../models/studentVisibility';
import { ENRICH_ONLY_FELLOWSHIP_SOURCES } from '../scrapers/fellowshipSourcePrecedence';

export interface ProgramDuplicateCandidate {
  id: string;
  title?: string;
  description?: string;
  sourceName?: string;
  tier: StudentVisibilityTier | string | undefined;
}

// A CommunityForce fund page is reached through an encrypted query that differs from link
// to link, so one fund carries several FundDetails URLs and the URL cannot identify it
// (#3988). Distinct funds do share titles, so the title alone cannot either; the printed
// title together with the fund's own description can.
const MIN_IDENTIFYING_DESCRIPTION_LENGTH = 80;

const normalizedText = (value: unknown): string =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export function programFundIdentityKey(
  program: Pick<ProgramDuplicateCandidate, 'title' | 'description'>,
): string | null {
  const title = normalizedText(program.title);
  const description = normalizedText(program.description);
  if (!title || description.length < MIN_IDENTIFYING_DESCRIPTION_LENGTH) return null;
  return `${title}\u0000${description}`;
}

const TIER_PREFERENCE: Record<string, number> = {
  student_ready: 0,
  limited_but_safe: 1,
  operator_review: 2,
  suppressed: 3,
};

const tierPreference = (tier: unknown): number => TIER_PREFERENCE[String(tier)] ?? 4;

const ownerPreference = (sourceName: unknown): number =>
  ENRICH_ONLY_FELLOWSHIP_SOURCES.has(String(sourceName || '')) ? 1 : 0;

function preferredCopy(a: ProgramDuplicateCandidate, b: ProgramDuplicateCandidate): number {
  return (
    tierPreference(a.tier) - tierPreference(b.tier) ||
    ownerPreference(a.sourceName) - ownerPreference(b.sourceName) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Maps each redundant copy of a fund to the copy that is served in its place. The kept copy
 * is the one most fit to serve on its own, then the one an owning lane holds rather than the
 * enrich-only catalog, then the oldest row.
 */
export function selectDuplicateProgramCopies(
  programs: readonly ProgramDuplicateCandidate[],
): Map<string, string> {
  const copiesByFund = new Map<string, ProgramDuplicateCandidate[]>();
  for (const program of programs) {
    const key = programFundIdentityKey(program);
    if (!key) continue;
    const copies = copiesByFund.get(key);
    if (copies) copies.push(program);
    else copiesByFund.set(key, [program]);
  }

  const keptCopyById = new Map<string, string>();
  for (const copies of copiesByFund.values()) {
    if (copies.length < 2) continue;
    const [kept, ...redundant] = [...copies].sort(preferredCopy);
    for (const copy of redundant) keptCopyById.set(copy.id, kept.id);
  }
  return keptCopyById;
}
