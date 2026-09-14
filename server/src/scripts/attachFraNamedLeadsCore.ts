export interface FraLeadCandidateEntity {
  slug?: unknown;
  name?: unknown;
  entityType?: unknown;
  sourceUrls?: unknown;
  studentVisibilityReasons?: unknown;
}

export interface FraLeadResearcher {
  displayName?: unknown;
}

export interface FraLeadPlan {
  personName: string;
  corroboratedBySlug: boolean;
  corroboratedByCitedUrl: boolean;
}

const NAME_SUFFIXES = /\b(lab|laboratory|faculty research|research group|group|research)\b/gi;

export const comparableName = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/**
 * The person an FRA row already names. These rows are minted as
 * `<Person Name> Faculty Research`, so the subject is stated by the row itself and
 * attaching that person recovers a declared identity rather than inferring a new one.
 * Returns '' when stripping the template leaves fewer than two words, because a
 * single token is a surname and surname matching is the graft mechanism this lane
 * exists to avoid (#2633).
 */
export function personNameFromEntityName(entityName: unknown): string {
  const stripped = String(entityName ?? '')
    .replace(NAME_SUFFIXES, '')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.split(/\s+/).filter(Boolean).length >= 2 ? stripped : '';
}

/**
 * Name equality is necessary and not sufficient, so a plan is only returned when the
 * row's slug or one of its cited URLs independently names the same person. Both
 * comparisons run over accent- and punctuation-folded text: two rows in the cohort
 * carry an apostrophe and an acute accent, and unfolded comparison silently drops
 * them, which is the same failure already recorded for slug-person matching.
 */
export function planFraLeadAttachment(
  entity: FraLeadCandidateEntity,
  researchersByComparableName: ReadonlyMap<string, readonly FraLeadResearcher[]>,
): FraLeadPlan | null {
  const personName = personNameFromEntityName(entity.name);
  if (!personName) return null;

  const matches = researchersByComparableName.get(comparableName(personName)) ?? [];
  if (matches.length !== 1) return null;

  const tokens = personName
    .split(/\s+/)
    .map(comparableName)
    .filter((token) => token.length > 2);
  if (tokens.length === 0) return null;

  const slug = comparableName(entity.slug);
  const corroboratedBySlug = tokens.every((token) => slug.includes(token));

  const citedUrls = Array.isArray(entity.sourceUrls)
    ? entity.sourceUrls.filter((url): url is string => typeof url === 'string')
    : [];
  const corroboratedByCitedUrl = citedUrls.some((url) =>
    tokens.every((token) => comparableName(url).includes(token)),
  );

  if (!corroboratedBySlug || !corroboratedByCitedUrl) return null;
  return { personName, corroboratedBySlug, corroboratedByCitedUrl };
}

const HARD_BLOCKERS_OTHER_THAN_LEAD = new Set([
  'missing_description',
  'missing_card_description',
  'thin_description',
  'blank_public_description',
  'unusable_name',
  'duplicate_name_risk',
  'duplicate_risk',
  'exact_url_duplicate_risk',
  'profile_identity_risk',
  'generic_directory_shell',
  'profile_biography_shell',
  'content_page_risk',
  'non_research_entity',
  'non_research_program',
  'research_infrastructure_only',
  'non_owner_grant_shell',
  'grant_only_no_current_yale_source',
  'permanently_closed',
  'lab_name_org_type_mismatch',
  'inactive_at_yale',
  'archive_review',
  'not_undergraduate_relevant',
]);

/**
 * Whether a lead is the ONLY thing holding this row back. A row with another hard
 * blocker still gains a correct lead, but it does not reach students, so the two are
 * counted separately: reporting attachments as though they were promotions is the
 * counter error #2440 records.
 */
export function leadWouldUnblock(entity: FraLeadCandidateEntity): boolean {
  const reasons = Array.isArray(entity.studentVisibilityReasons)
    ? entity.studentVisibilityReasons.filter((r): r is string => typeof r === 'string')
    : [];
  if (!reasons.includes('missing_lead')) return false;
  return !reasons.some((reason) => HARD_BLOCKERS_OTHER_THAN_LEAD.has(reason));
}
