/**
 * Which live rows the mint gate would refuse today because the person profile that
 * gave the row its identity carries a research-support or technical title, a
 * non-research staff role (#3410), a student or graduate title, or a trainee rank the
 * owner ruled cannot host a student's research.
 *
 * Those four classes are the whole population. The trainee class is decided before the
 * faculty-keyword yield below, because `FACULTY_KEYWORDS` spells `postdoctoral` and a
 * hyphen would otherwise decide an irreversible archive; the student class runs after
 * it, because no faculty keyword spells a student rank. Each has its own predicate, and
 * `docs/research-data-pipeline.md` records why.
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
  isStudentTitle,
  isSubordinateResearchRank,
  looksLikeNonResearchTitle,
  statesAnyFacultyAppointment,
} from '../scrapers/sources/yaleDirectoryScraper';
import {
  namesARankItServesRatherThanHolds,
  titleRankSpans,
  titleResearchOwnership,
} from '../scrapers/utils/titleResearchOwnership';
import { stripInvisibleFormatCharacters } from '../utils/invisibleFormatCharacters';
import { isSharedPeopleRosterUrl } from '../utils/researchHomeWebsiteUrl';
import { normalizeOfficialProfileDestination } from '../services/leadProfileIdentity';
import { publicStudentVisibilityTiers } from '../models/studentVisibility';

export const STAFF_MINTED_ENTITY_ARCHIVE_REASON = 'research-entity:retire-staff-minted-entities';

export type StaffMintedEntityReason =
  | 'non_research_staff_title'
  | 'research_support_staff_title'
  | 'student_title'
  | 'non_hosting_trainee_title'
  | 'administrative_staff_title';

export const STAFF_MINTED_ENTITY_REASON_PRECEDENCE: readonly StaffMintedEntityReason[] = [
  'non_research_staff_title',
  'research_support_staff_title',
  'student_title',
  'non_hosting_trainee_title',
  'administrative_staff_title',
];

export type StaffMintedEntityRefusal =
  | 'no-identity-profile-url'
  | 'no-stored-title'
  | 'title-owns-research'
  | 'title-evidence-disagrees'
  | 'manually-locked'
  | 'operator-intent'
  | 'has-foreign-website'
  | 'has-foreign-role-edge'
  | 'description-states-research';

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
  /** Whether the row's own description states research; an administrative title needs it false. */
  descriptionStatesResearch?: boolean;
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

const ADMINISTRATIVE_HEAD_NOUN =
  /\b(?:director|dean|chair|chief|head|manager|coordinator|advis(?:e|o)r)s?\b/i;

function statesOnlyThatItsHolderIsAStudent(title: string | undefined | null): boolean {
  if (!isStudentTitle(title)) return false;
  if (titleResearchOwnership(title) === 'owns_research') return false;
  return !ADMINISTRATIVE_HEAD_NOUN.test(stripInvisibleFormatCharacters(String(title)));
}

// The ranks the owner ruled cannot host a student's research (2026-10-04). Clinical
// fellows, residents, staff affiliates and postgraduate associates await a ruling, so a
// title naming any of them beside a ruled rank stays out of an irreversible archive.
const OWNER_RULED_NON_HOSTING_RANK =
  /^(?:post-?doc(?:toral)?|research (?:associate|assistant)|visiting (?:fellow|scholar|researcher))$/i;

/**
 * A rank that cannot host a student's research, on two witnesses that must agree: the
 * rank lattice finds no span that owns research anywhere in the title, and the mint
 * vocabulary names a rank held inside someone else's group. The lattice is the reason a
 * hyphen cannot decide this the way it decided the faculty-keyword yield, because both
 * spellings of a rank live in one pattern there. Every rank span must be one the owner
 * ruled on, so a research scientist, which hosts by the owner's rule even where the
 * lattice reads an associate one as working in another group, spares the title.
 */
function statesOnlyANonHostingTraineeRank(title: string | undefined | null): boolean {
  const clean = stripInvisibleFormatCharacters(String(title ?? ''));
  if (!clean.trim()) return false;
  if (titleResearchOwnership(clean) !== 'works_in_another_group') return false;
  if (!isSubordinateResearchRank(clean)) return false;
  if (!titleRankSpans(clean).every((span) => OWNER_RULED_NON_HOSTING_RANK.test(span.text))) {
    return false;
  }
  if (namesARankItServesRatherThanHolds(clean)) return false;
  return !ADMINISTRATIVE_HEAD_NOUN.test(clean);
}

const ADMINISTRATIVE_OBJECT =
  /\b(?:career services?|(?:academic|student|faculty) affairs|financial (?:aid|strategy)|finance|administration|education technology|medical education|admissions|communications|alumni|human resources)\b/i;

/**
 * An office that runs a school rather than a research group: an administrative head noun
 * over an administrative object, with no rank that owns research and no research named
 * anywhere in the title. The planner archives on it only when the row's own description
 * states no research either, so the title is one of two witnesses, never the only one.
 */
function statesOnlyAnAdministrativeRole(title: string | undefined | null): boolean {
  const clean = stripInvisibleFormatCharacters(String(title ?? ''));
  if (!ADMINISTRATIVE_HEAD_NOUN.test(clean) || !ADMINISTRATIVE_OBJECT.test(clean)) return false;
  if (/\bresearch\b/i.test(clean)) return false;
  return titleResearchOwnership(clean) !== 'owns_research';
}

export function staffMintedEntityReasonFor(
  title: string | undefined | null,
): StaffMintedEntityReason | undefined {
  if (statesOnlyANonHostingTraineeRank(title)) return 'non_hosting_trainee_title';
  if (statesAnyFacultyAppointment(title)) return undefined;
  if (looksLikeNonResearchTitle(title)) return 'non_research_staff_title';
  if (isResearchSupportStaffTitle(title)) return 'research_support_staff_title';
  if (statesOnlyThatItsHolderIsAStudent(title)) return 'student_title';
  if (statesOnlyAnAdministrativeRole(title)) return 'administrative_staff_title';
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
    if (reason === 'administrative_staff_title' && candidate.descriptionStatesResearch !== false) {
      refuse('description-states-research');
      continue;
    }
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
    student_title: 0,
    non_hosting_trainee_title: 0,
    administrative_staff_title: 0,
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
    'description-states-research': 0,
  };
  for (const entry of refused) counts[entry.reason] += 1;
  return counts;
}

export interface SoleLeadRecord {
  profileLinks?: unknown;
  title?: unknown;
}

/**
 * The identity a row minted from a shared roster listing borrows from the one person on it.
 * A listing names many people, so it cannot say whose title applies; the sole person with a
 * live edge on the row can, through their own single verified primary page. That page's live
 * titles decide, and the person's stored title stands in only when the page has none. Two or
 * more people on the row, or a lead with no single verified primary page, leaves no identity.
 */
export function soleLeadIdentityFor(input: {
  mintUrl: unknown;
  rolePersonIds: readonly string[];
  leadById: ReadonlyMap<string, SoleLeadRecord>;
  observedTitlesByDestination: ReadonlyMap<string, ReadonlySet<string>>;
}): { url: string; titles: string[]; personIds: string[] } | undefined {
  if (typeof input.mintUrl !== 'string' || !isSharedPeopleRosterUrl(input.mintUrl))
    return undefined;
  const people = [...new Set(input.rolePersonIds)];
  if (people.length !== 1) return undefined;
  const lead = input.leadById.get(people[0]);
  const links = Array.isArray(lead?.profileLinks) ? (lead.profileLinks as unknown[]) : [];
  const primary = links.filter((link): link is Record<string, unknown> => {
    if (!link || typeof link !== 'object') return false;
    const record = link as Record<string, unknown>;
    return (
      record.kind === 'YALE_OFFICIAL' &&
      record.purpose === 'PRIMARY_IDENTITY' &&
      Boolean(record.verifiedAt) &&
      isPersonProfileIdentityUrl(record.url)
    );
  });
  if (primary.length !== 1) return undefined;
  const url = String(primary[0].url);
  const observed = [
    ...(input.observedTitlesByDestination.get(normalizeOfficialProfileDestination(url)) ?? []),
  ];
  const stored = typeof lead?.title === 'string' ? lead.title.trim() : '';
  return {
    url,
    titles: observed.length > 0 ? observed : stored ? [stored] : [],
    personIds: people,
  };
}

export function officialProfileUrlSpellings(url: string): string[] {
  const spellings = new Set([url]);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [...spellings];
  }
  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
  const path = parsed.pathname.replace(/\/+$/, '');
  for (const scheme of ['https:', 'http:']) {
    for (const prefix of ['', 'www.']) {
      for (const slash of ['', '/']) {
        spellings.add(`${scheme}//${prefix}${host}${path}${slash}${parsed.search}`);
      }
    }
  }
  return [...spellings];
}
