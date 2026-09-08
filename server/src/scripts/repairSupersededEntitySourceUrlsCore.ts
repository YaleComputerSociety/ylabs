import { personPageNameTokensFromUrl } from '../scrapers/utils/personProfileEntityMatch';
import {
  IDENTIFIED_FACULTY_LEAD_WAYS_IN_DERIVATION_KEY,
  ORGANIZATIONAL_HOME_WAYS_IN_DERIVATION_KEY,
} from '../services/accessAcceptanceLevel';
import { isYaleOfficialProfileUrl } from './backfillResearcherOfficialProfileLinksCore';
import {
  officialProfileLinkCandidates,
  profileSlugNamesPerson,
} from './verifyOfficialProfileLinksCore';

/**
 * The two derivation keys whose `source.url` is a pointer to the page whose
 * existence is the claim, rather than a citation for a quoted excerpt. Both carry
 * synthesized boilerplate ("Identified faculty lead with an official research
 * page ..."), so re-pointing one at the same person's same official profile at its
 * current path preserves the claim exactly. Every other signal quotes the page it
 * cites, and re-pointing one of those would assert we read a page we never
 * fetched, so they are left alone even when their citation is dead.
 */
export const REPOINTABLE_SIGNAL_DERIVATION_KEYS: readonly string[] = [
  IDENTIFIED_FACULTY_LEAD_WAYS_IN_DERIVATION_KEY,
  ORGANIZATIONAL_HOME_WAYS_IN_DERIVATION_KEY,
];

export function isRepointableSignalCitation(derivationKey: unknown): boolean {
  return (
    typeof derivationKey === 'string' && REPOINTABLE_SIGNAL_DERIVATION_KEYS.includes(derivationKey)
  );
}

export interface EntitySourceUrlRepairFacts {
  id: string;
  slug?: string;
  name?: string;
  displayName?: string;
  sourceUrls?: unknown;
  leadDisplayNames?: readonly string[];
}

export interface EntitySourceUrlRepairTarget {
  entityId: string;
  slug?: string;
  host: string;
  url: string;
  personDisplayName: string;
}

const cleanString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const urlHost = (value: string): string | undefined => {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return undefined;
  }
};

/**
 * Names that may be used to decide whose page a stored citation is. Lead names
 * come first because a `RoleAssignment` is an asserted fact about the entity,
 * while the entity's own name is only person-scoped for some kinds; both still
 * have to satisfy `profileSlugNamesPerson`, so including the weaker source widens
 * reach without widening what counts as a match.
 */
export function candidatePersonNames(facts: EntitySourceUrlRepairFacts): string[] {
  const names = [...(facts.leadDisplayNames || []), facts.displayName, facts.name].map(cleanString);
  return Array.from(new Set(names.filter(Boolean)));
}

/**
 * Stored `sourceUrls` entries that are a Yale person page this entity can name a
 * person for. Both halves are load-bearing and neither is sufficient alone.
 *
 * The shape reader keeps lab and section pages out: `medicine.yale.edu/lab/le-zhang/`
 * ends in a person-looking slug but is a lab page, and `/directory/faculty/<slug>`
 * is a directory row rather than a person page.
 *
 * The person check keeps a same-slug stranger out. Slug equality alone matched
 * `ysm-faculty-alicia-sanchez`'s `/lab/le-zhang` against an unrelated
 * `/profile/le-zhang/`, and same-surname people really do exist across Yale sites
 * (#468), so an entity that can name nobody for a URL repairs nothing.
 */
export function entitySourceUrlRepairTargets(
  facts: EntitySourceUrlRepairFacts,
): EntitySourceUrlRepairTarget[] {
  const sourceUrls = Array.isArray(facts.sourceUrls) ? facts.sourceUrls : [];
  const personNames = candidatePersonNames(facts);
  const targets: EntitySourceUrlRepairTarget[] = [];
  const seen = new Set<string>();

  for (const raw of sourceUrls) {
    const url = cleanString(raw);
    if (!url || seen.has(url)) continue;
    if (!isYaleOfficialProfileUrl(url)) continue;
    if (!personPageNameTokensFromUrl(url)) continue;
    const host = urlHost(url);
    if (!host) continue;
    const personDisplayName = personNames.find((name) => profileSlugNamesPerson(url, name));
    if (!personDisplayName) continue;
    seen.add(url);
    targets.push({ entityId: facts.id, slug: facts.slug, host, url, personDisplayName });
  }
  return targets;
}

/**
 * Replacement candidates for one stored citation, in the order the researcher
 * lane already established, minus any candidate whose path equals the stored one.
 * Each is a hypothesis the caller must still probe: nothing here decides that a
 * page exists.
 */
export function entitySourceUrlReplacementCandidates(
  target: EntitySourceUrlRepairTarget,
  observedSameHostUrls: readonly string[] = [],
): string[] {
  return officialProfileLinkCandidates(target.url, target.personDisplayName, observedSameHostUrls);
}

export type EntitySourceUrlRepairVerdict = 'healthy' | 'repaired' | 'dead' | 'inconclusive';

export interface EntitySourceUrlRepairRow {
  entityId: string;
  slug?: string;
  host: string;
  before: string;
  verdict: EntitySourceUrlRepairVerdict;
  httpStatusCode?: number;
  after?: string;
}

export interface EntitySourceUrlRepairSummary {
  entitiesConsidered: number;
  citationsProbed: number;
  healthy: number;
  repaired: number;
  dead: number;
  inconclusive: number;
}

export function summarizeEntitySourceUrlRepair(
  entitiesConsidered: number,
  rows: readonly EntitySourceUrlRepairRow[],
): EntitySourceUrlRepairSummary {
  const summary: EntitySourceUrlRepairSummary = {
    entitiesConsidered,
    citationsProbed: rows.length,
    healthy: 0,
    repaired: 0,
    dead: 0,
    inconclusive: 0,
  };
  for (const row of rows) summary[row.verdict] += 1;
  return summary;
}

/**
 * The stored `sourceUrls` array with one citation re-pointed, preserving order and
 * dropping a duplicate the replacement collides with. Order matters because
 * `officialNonGrantSourceUrl` in the access materializer reads the first non-grant
 * entry, so reordering the array would silently move which page a derived ways-in
 * signal cites.
 */
export function rewriteSourceUrl(
  sourceUrls: readonly unknown[],
  before: string,
  after: string,
): string[] {
  const rewritten: string[] = [];
  for (const raw of sourceUrls) {
    const url = cleanString(raw);
    if (!url) continue;
    const next = url === before ? after : url;
    if (!rewritten.includes(next)) rewritten.push(next);
  }
  return rewritten;
}
