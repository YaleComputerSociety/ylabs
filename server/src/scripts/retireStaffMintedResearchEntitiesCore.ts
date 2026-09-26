/**
 * Which live rows the mint gate would refuse today because the person profile that
 * gave the row its identity carries a research-support or technical title, or a
 * non-research staff role (#3410).
 *
 * Those two classes are the whole population. A trainee rank is deliberately NOT in
 * it, even though every mint lane still refuses one: with a faculty-keyword yield,
 * whether a trainee row archived would turn on whether `FACULTY_KEYWORDS` happens to
 * spell the rank the way `SUBORDINATE_RESEARCH_RANK_PATTERNS` does - `postdoc` yes,
 * `post-doc` no - and no irreversible archive should turn on a hyphen. The pre-#2304
 * trainee residue needs its own issue and its own predicate.
 *
 * The pass is strictly more conservative than the mint gate: any title that states a
 * faculty appointment anywhere yields, because minting is reversible by the next run
 * and archiving is not.
 *
 * That yield asks `statesAnyFacultyAppointment` rather than `isFacultyTitle`, and the
 * difference is load-bearing: `isFacultyTitle` short-circuits on
 * `looksLikeNonResearchTitle`, so `'Associate Professor of Medicine; Clinical Program
 * Manager'` would lose its faculty reading to `\bmanager\b` and archive a
 * professorship. Four narrower yields were tried before this one and each had a
 * corpus counterexample: a keyword-by-keyword filtered vocabulary left `associate
 * research scientist` unarchivable, because every title that phrase matches contains
 * the faculty keyword `research scientist`; a clause split on `;` and `,` archived
 * `'Visiting Assistant Professor'` and `'Visiting Fellow and Lecturer in Law'`,
 * because a refused phrase sharing a clause defeated the yield; and `isFacultyTitle`
 * on the whole title archived the conjoined-staff-word titles above. Do not
 * reintroduce any of them: a predicate whose counterexamples keep arriving is the
 * wrong kind of predicate for an irreversible bulk archive.
 *
 * The verdict is re-derived from the stored title on every run rather than from any
 * earlier pass's plan state, so a second run reaches the same answer instead of
 * going blind once the first has written (#2858). What makes a second run a no-op is
 * that the row query is live-only, so an archived row is never offered again.
 */
import {
  isResearchSupportStaffTitle,
  looksLikeNonResearchTitle,
  statesAnyFacultyAppointment,
} from '../scrapers/sources/yaleDirectoryScraper';
import { isSharedPeopleRosterUrl } from '../utils/researchHomeWebsiteUrl';
import { publicStudentVisibilityTiers } from '../models/studentVisibility';

export const STAFF_MINTED_ENTITY_ARCHIVE_REASON = 'research-entity:retire-staff-minted-entities';

export type StaffMintedEntityReason = 'non_research_staff_title' | 'research_support_staff_title';

export const STAFF_MINTED_ENTITY_REASON_PRECEDENCE: readonly StaffMintedEntityReason[] = [
  'non_research_staff_title',
  'research_support_staff_title',
];

export type StaffMintedEntityRefusal =
  | 'no-identity-profile-url'
  | 'no-stored-title'
  | 'title-owns-research'
  | 'title-evidence-disagrees'
  | 'manually-locked'
  | 'operator-intent'
  | 'has-foreign-website'
  | 'has-foreign-role-edge';

export interface StaffMintedEntityCandidate {
  id: string;
  entityType?: string;
  tier?: string;
  identityProfileUrl?: string | null;
  /** Every live title any lane states for the identity page. */
  storedTitles?: readonly string[];
  manuallyLockedFields?: readonly string[];
  visibilityOverrideTier?: string | null;
  operatorProvenanceSourceNames?: readonly string[];
  hasForeignWebsite?: boolean;
  identityPersonIds?: readonly string[];
  roleEdgePersonIds?: readonly string[];
}

export interface StaffMintedEntityArchivePlan {
  id: string;
  reason: StaffMintedEntityReason;
  entityType: string;
  tier: string;
  wasServed: boolean;
  selfRoleEdges: number;
}

export interface StaffMintedEntityRefused {
  id: string;
  reason: StaffMintedEntityRefusal;
}

export interface StaffMintedEntityRetirementPlan {
  scanned: number;
  toArchive: StaffMintedEntityArchivePlan[];
  refused: StaffMintedEntityRefused[];
}

const SERVED_TIERS = new Set<string>(publicStudentVisibilityTiers);

/**
 * A page about exactly one person, which is the only citation whose stored title
 * may decide a row's fate. A lab microsite or a department landing page says
 * nothing about whose title applies, so a row whose identity came from one is
 * refused rather than judged on whatever title happens to be stored beside it.
 *
 * The person-scoped path shape is not sufficient on its own: `/people/faculty`,
 * `/people/core-faculty` and `/micropath/people/primary-faculty/` all match it and
 * are nobody's own profile, so whichever person's title happened to be stored
 * beside that URL would speak for every row minted from the roster. Archival
 * cannot be undone by re-scraping, so the shared-roster shape is refused through
 * `isSharedPeopleRosterUrl`, the predicate the repo already owns for it, rather
 * than through a second regex that would drift from it.
 */
export function isPersonProfileIdentityUrl(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false;
  let pathname: string;
  try {
    pathname = new URL(value).pathname.toLowerCase();
  } catch {
    return false;
  }
  if (!/\/(?:profile|profiles|person|people|faculty)\/[^/]+/.test(pathname)) return false;
  return !isSharedPeopleRosterUrl(value);
}

export function staffMintedEntityReasonFor(
  title: string | undefined | null,
): StaffMintedEntityReason | undefined {
  if (statesAnyFacultyAppointment(title)) return undefined;
  if (looksLikeNonResearchTitle(title)) return 'non_research_staff_title';
  if (isResearchSupportStaffTitle(title)) return 'research_support_staff_title';
  return undefined;
}

/**
 * Archival cannot be undone by re-scraping, so every uncertainty refuses.
 *
 * That includes disagreement between lanes about what the person's title is. The
 * title read is lane-agnostic by necessity - several lanes write a `user` `title`
 * against the same profile URL and none of them owns the question - and on
 * Development 1,343 identity pages carry more than one live title, of which 20
 * disagree about whether the person owns research. The disagreements run both ways:
 * a roster subheading that appends a second appointment to a professorship can read
 * as refused, and `official-profile-pi-backfill` stores award names as titles, which
 * read as owning research. So a row is archived only when EVERY live title refuses;
 * one title saying the person owns research is `title-evidence-disagrees`, which
 * keeps the row. That direction is deliberate: a kept defect is re-readable, an
 * archived professor is not.
 *
 * Two of the refusals are floors on operator intent outranking a derived title
 * verdict, and operator intent is not only `manuallyLockedFields`: an admin edit
 * leaves that list empty, so a visibility override tier and an operator- or
 * manual-named `fieldProvenance.sourceName` are read as well (#3357). On Development
 * 121 rows carry an override tier and 13 carry such a provenance name.
 *
 * The earlier version of this floor asked `claimedByFaculty`, which is not a field on
 * the schema: 6,287 stored documents carry it as legacy data, none of them `true`,
 * and a strict-schema projection drops it, so the refusal was a literal no-op
 * standing in for the check it appeared to make.
 *
 * The other two are measurements, and both had to compare rather than count,
 * because what there is to count is in each case something the same lane wrote from
 * the same page.
 *
 * `has-foreign-role-edge`: an edge attaching the very person whose profile minted
 * the row is that lane restating its own mint, and the `PI` edge on the row that
 * opened #3410 cites that person's own profile page as its provenance. Counting
 * edges refused 95 of 157 candidates and left every served defect in place.
 * Comparing people refuses 5. A row whose identity page matches no person has no
 * self to compare against, so every edge on it refuses.
 *
 * `has-foreign-website`: the mint gates write the row's `websiteUrl` FROM the lab
 * link on the person's own profile, which is the graft being retired and is exactly
 * what the microsite lane followed to write the PI's lab prose. A website whose
 * provenance is the row's own identity page is therefore not an independent
 * identity and must not spare the row: refusing on any website at all spared 22 of
 * the 34 rows that carry one, which is the defect rather than a floor. A website
 * from any other source does refuse, and one such field is enough, because that
 * identity did not come from here.
 */
export function planStaffMintedEntityRetirement(
  candidates: readonly StaffMintedEntityCandidate[],
): StaffMintedEntityRetirementPlan {
  const toArchive: StaffMintedEntityArchivePlan[] = [];
  const refused: StaffMintedEntityRefused[] = [];

  for (const candidate of candidates) {
    const refuse = (reason: StaffMintedEntityRefusal) => refused.push({ id: candidate.id, reason });

    if (!isPersonProfileIdentityUrl(candidate.identityProfileUrl)) {
      refuse('no-identity-profile-url');
      continue;
    }
    const titles = (candidate.storedTitles || [])
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter((value) => value !== '');
    if (titles.length === 0) {
      refuse('no-stored-title');
      continue;
    }
    const reasons = titles.map((value) => staffMintedEntityReasonFor(value));
    if (reasons.every((value) => value === undefined)) {
      refuse('title-owns-research');
      continue;
    }
    if (reasons.some((value) => value === undefined)) {
      refuse('title-evidence-disagrees');
      continue;
    }
    // Screen precedence rather than whichever title the cursor returned first, so the
    // report's reason breakdown is reproducible across runs.
    const reason = STAFF_MINTED_ENTITY_REASON_PRECEDENCE.find((value) =>
      reasons.includes(value),
    ) as StaffMintedEntityReason;
    if ((candidate.manuallyLockedFields || []).length > 0) {
      refuse('manually-locked');
      continue;
    }
    if (
      (candidate.visibilityOverrideTier || '').trim() !== '' ||
      (candidate.operatorProvenanceSourceNames || []).length > 0
    ) {
      refuse('operator-intent');
      continue;
    }
    if (candidate.hasForeignWebsite === true) {
      refuse('has-foreign-website');
      continue;
    }
    const identityPersonIds = new Set(candidate.identityPersonIds || []);
    const roleEdgePersonIds = candidate.roleEdgePersonIds || [];
    if (roleEdgePersonIds.some((personId) => !identityPersonIds.has(personId))) {
      refuse('has-foreign-role-edge');
      continue;
    }

    toArchive.push({
      id: candidate.id,
      reason,
      entityType: String(candidate.entityType || ''),
      tier: String(candidate.tier || ''),
      wasServed: SERVED_TIERS.has(String(candidate.tier || '')),
      selfRoleEdges: roleEdgePersonIds.length,
    });
  }

  return { scanned: candidates.length, toArchive, refused };
}

export function summarizeStaffMintedEntityReasons(
  planned: readonly StaffMintedEntityArchivePlan[],
): Record<StaffMintedEntityReason, number> {
  const counts: Record<StaffMintedEntityReason, number> = {
    non_research_staff_title: 0,
    research_support_staff_title: 0,
  };
  for (const entry of planned) counts[entry.reason] += 1;
  return counts;
}

export function summarizeStaffMintedEntityRefusals(
  refused: readonly StaffMintedEntityRefused[],
): Record<StaffMintedEntityRefusal, number> {
  const counts: Record<StaffMintedEntityRefusal, number> = {
    'no-identity-profile-url': 0,
    'no-stored-title': 0,
    'title-owns-research': 0,
    'title-evidence-disagrees': 0,
    'manually-locked': 0,
    'operator-intent': 0,
    'has-foreign-website': 0,
    'has-foreign-role-edge': 0,
  };
  for (const entry of refused) counts[entry.reason] += 1;
  return counts;
}
