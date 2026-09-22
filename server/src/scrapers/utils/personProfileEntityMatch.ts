import { normalizeName, slugify } from './scraperHelpers';
import { givenNamesAgree } from './piNameMatch';

export interface ResearchEntityIdentity {
  slug?: string;
  name?: string;
  displayName?: string;
  school?: string;
  schools?: string[];
  departments?: string[];
  sourceUrls?: string[];
  /**
   * The citations the entity ALREADY holds, as distinct from `sourceUrls`, which on
   * the materializer path carries the list being written.
   *
   * The two readers want different lists.
   * `independentCorroboratingSourcePageCount` corroborates a value against the value
   * being written, so it must read the projected list. The person-page owner check
   * asks whose page the row has already committed to, which is a property of the
   * stored row: a projection that empties the list would otherwise lose the owner in
   * the same pass that mints its replacement, which is how a stranger's page took
   * over a row whose own person's page had gone 404 (#2945). Falls back to
   * `sourceUrls` so a caller handing over a stored document needs no second field.
   */
  citedPersonPageUrls?: string[];
  fullDescription?: string;
  recentGrants?: Array<{ title?: string; abstract?: string } | null | undefined>;
}

const ROLE_WORDS = new Set([
  'lab',
  'laboratory',
  'labs',
  'faculty',
  'research',
  'area',
  'areas',
  'group',
  'center',
  'centre',
  'institute',
  'program',
  'programs',
  'the',
  'dept',
  'family',
  'observatory',
  'project',
  'projects',
]);

const CREDENTIAL_TOKENS = new Set([
  'phd',
  'md',
  'ms',
  'msc',
  'mph',
  'dr',
  'mba',
  'dds',
  'dvm',
  'rn',
  'do',
  'jr',
  'sr',
  'ii',
  'iii',
  'iv',
  'esq',
  'edd',
  'jd',
  'scd',
]);

const SLUG_SHELL_PREFIXES = [
  /^nih-pi-/,
  /^nsf-pi-/,
  /^doe-pi-/,
  /^faculty-research-area-/,
  /^center-/,
];

// A slug generated from a single PI's grant or profile record rather than the
// entity's own organizational identity: `nih-pi-<name>`, `nsf-pi-<name>`,
// `doe-pi-<name>`, and `faculty-research-area-<name>` are minted directly from
// that person's record, and `<surname>-lab-<code>` is the generated key for a
// person's lab page. An entity later reclassified to a multi-PI org kind
// (center/institute/program) keeps this slug, so it remains the tell that the
// entity's only ever-recorded identity is one person's, not the
// organization's (issue #1595).
const PERSON_OR_GRANT_SHELL_SLUG_PREFIXES = [
  /^nih-pi-/,
  /^nsf-pi-/,
  /^doe-pi-/,
  /^faculty-research-area-/,
];
const LAB_SHELL_SLUG_SUFFIX_RE = /-lab-[a-z]{0,4}\d{1,6}$/i;

/**
 * Whether an entity's slug betrays single-PI/single-grant shell provenance
 * rather than the entity's own organizational identity.
 */
export function isPersonOrGrantShellSlug(slug: unknown): boolean {
  const value = textValue(slug).toLowerCase();
  if (!value) return false;
  return (
    PERSON_OR_GRANT_SHELL_SLUG_PREFIXES.some((pattern) => pattern.test(value)) ||
    LAB_SHELL_SLUG_SUFFIX_RE.test(value)
  );
}

// A department-roster listing page (`/people/linguistics-faculty`,
// `/people/our-people`) splits into two dash-separated tokens just like a real
// person slug, but names a page, not a person. Rejecting any slug that carries one
// of these words keeps such listing pages from being misparsed as a two-token name.
const ROSTER_PAGE_WORDS = new Set([
  'faculty',
  'people',
  'staff',
  'directory',
  'index',
  'roster',
  'listing',
  'emeriti',
  'postdocs',
  'students',
  'alumni',
  'members',
  'team',
  'our',
  // `/people/joining-lab` splits into two tokens and was read as a person named
  // "Joining Lab", so a lab's own how-to-join page counted as somebody else's
  // profile. Nobody's surname is "lab" (#2570).
  'lab',
  'labs',
  'join',
  'joining',
]);

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Human-name tokens of a Yale `/people/<slug>` or `/profile/<slug>` URL, or null
 * when the URL is not a name-shaped Yale person page. Netid-style slugs (`br574`),
 * single-token slugs, and non-Yale hosts return null so they are never gated:
 * only a slug with two or more alphabetic tokens carries a checkable person name.
 * Trailing academic credential tokens (`phd`, `md`, ...) are dropped.
 */
export function personProfileNameTokensFromUrl(value: unknown): string[] | null {
  const url = yaleUrlOrNull(value);
  if (!url) return null;
  const match = url.pathname.match(/^\/(?:people|profile)\/([^/]+)\/?$/i);
  if (!match) return null;
  return personSlugNameTokens(match[1]);
}

function yaleUrlOrNull(value: unknown): URL | null {
  const urlText = textValue(value);
  if (!urlText) return null;
  let url: URL;
  try {
    url = new URL(urlText);
  } catch {
    return null;
  }
  return /(^|\.)yale\.edu$/i.test(url.hostname) ? url : null;
}

/**
 * The human-name tokens of one URL path leaf, or null when the leaf carries no
 * checkable person name: a netid or numeric leaf, a single token, or a collective
 * roster word. Exported so a caller reading a leaf this module's own shape readers
 * do not cover - a vanity path, a school-specific person path - tokenizes it
 * against the same credential and roster vocabulary instead of restating it.
 */
export function personPageLeafNameTokens(leaf: unknown): string[] | null {
  return typeof leaf === 'string' && leaf.trim() ? personSlugNameTokens(leaf.trim()) : null;
}

/**
 * The person-name tokens of a research entity's own title, in order, or null when
 * the title names no person.
 *
 * A person-scoped entity is titled "<person> Faculty Research", "<person> - Research"
 * or "<person> Lab", so the role suffix has to come off before the last token can be
 * read as a surname. The roster-word refusal that guards a URL leaf must NOT apply
 * here: `faculty` and `research` are role words in a title and would reject every
 * FACULTY_RESEARCH_AREA name.
 */
export function personNameTokensFromEntityTitle(value: unknown): string[] | null {
  if (typeof value !== 'string') return null;
  const tokens = value
    .toLowerCase()
    .split(/[^a-z]+/i)
    .filter(
      (token) => token.length >= 2 && !CREDENTIAL_TOKENS.has(token) && !ROLE_WORDS.has(token),
    );
  return tokens.length >= 2 ? tokens : null;
}

function personSlugNameTokens(rawSlug: string): string[] | null {
  if (/\d/.test(rawSlug)) return null;
  const tokens = rawSlug
    .toLowerCase()
    .split(/[^a-z]+/i)
    .filter((token) => token.length >= 2 && !CREDENTIAL_TOKENS.has(token));
  if (tokens.some((token) => ROSTER_PAGE_WORDS.has(token))) return null;
  return tokens.length >= 2 ? tokens : null;
}

const PERSON_PAGE_SLUG_PATHS: readonly RegExp[] = [
  /^\/(?:people|profile|person)\/([^/]+)$/i,
  /^\/(?:people|person)\/[^/]+\/([^/]+)$/i,
  /^\/[^/]+\/profile\/([^/]+)$/i,
];

/**
 * Like `personProfileNameTokensFromUrl`, but also reading the person slug out of
 * the wider person-page shapes Yale sites actually publish: `/person/<slug>`
 * (jackson.yale.edu), a section-nested `/people/<section>/<slug>`
 * (english.yale.edu/people/full-part-time-lecturers-creative-writers/<slug>), and
 * the nested CMS profile `/<section>/profile/<slug>` that
 * `supersedesOfficialProfileUrl` already treats as a canonical person page.
 * Kept separate from the strict reader on purpose: that one gates a materializer
 * check on whether a field came *only* from person-profile pages, and widening
 * what counts as such a page there would silently change which fields that guard
 * suppresses. This reader is for finding a person's page, not for gating writes.
 */
export function personPageNameTokensFromUrl(value: unknown): string[] | null {
  const url = yaleUrlOrNull(value);
  if (!url) return null;
  const path = url.pathname.replace(/\/+$/, '');
  for (const pattern of PERSON_PAGE_SLUG_PATHS) {
    const match = path.match(pattern);
    if (match) return personSlugNameTokens(match[1]);
  }
  return null;
}

/**
 * Identity tokens that name the person or lab an entity belongs to, drawn from
 * both its display name and its slug (grant-shell prefixes, trailing ObjectId or
 * netid suffixes, generic role words, and credential tokens removed). Slug tokens
 * are included because a slug such as `faculty-research-area-david-fiellin` names
 * the person even when the display name is an organizational title.
 */
export function researchEntityIdentityTokens(entity: ResearchEntityIdentity): string[] {
  const nameTokens = slugify(normalizeName(textValue(entity.name || entity.displayName)))
    .split('-')
    .filter(Boolean);
  let slug = textValue(entity.slug)
    .toLowerCase()
    .replace(/-[0-9a-f]{24}$/i, '')
    .replace(/-[a-z]{1,4}\d{1,6}$/i, '');
  for (const prefix of SLUG_SHELL_PREFIXES) slug = slug.replace(prefix, '');
  const slugTokens = slug.split('-').filter(Boolean);
  return Array.from(new Set([...nameTokens, ...slugTokens])).filter(
    (token) => !ROLE_WORDS.has(token) && !CREDENTIAL_TOKENS.has(token),
  );
}

function tokensOverlap(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 3 && b.length >= 3) return a.includes(b) || b.includes(a);
  return false;
}

const YALE_SCHOOL_TOKEN_BY_SUBDOMAIN: Record<string, string> = {
  medicine: 'medicine',
  som: 'management',
  nursing: 'nursing',
  law: 'law',
  ysph: 'public-health',
  publichealth: 'public-health',
  environment: 'environment',
  divinity: 'divinity',
  drama: 'drama',
  architecture: 'architecture',
  art: 'art',
  music: 'music',
  seas: 'engineering',
};

// Only a host that reliably belongs to a single discipline may declare a school
// contradiction. The medical-campus hosts (medicine.yale.edu, ysph.yale.edu) and
// the science/health-adjacent schools (nursing, environment, engineering) legitimately
// host cross-appointed, affiliated, and University-Professor faculty whose primary
// school is elsewhere, so a page there does not prove a different-school identity and
// would falsely reject correct content. School of Management (som.yale.edu) and the
// arts/professional schools below do not carry other schools' researchers, so a page
// there naming a non-member school is a genuine homonym collision (issue #1045).
const CONTRADICTION_SOURCE_SUBDOMAINS = new Set([
  'som',
  'law',
  'divinity',
  'drama',
  'architecture',
  'art',
  'music',
]);

const YALE_SCHOOL_TOKEN_KEYWORDS: Array<[RegExp, string]> = [
  [/\bpublic health\b/i, 'public-health'],
  [/\bnursing\b/i, 'nursing'],
  [/\bmanagement\b/i, 'management'],
  [/\blaw\b/i, 'law'],
  [/\bdivinity\b/i, 'divinity'],
  [/\bdrama\b/i, 'drama'],
  [/\barchitecture\b/i, 'architecture'],
  [/\benvironment(?:al)?\b|\bforestry\b/i, 'environment'],
  [/\bengineering\b|\bapplied science\b/i, 'engineering'],
  [/\bmusic\b/i, 'music'],
  [/\bschool of art\b/i, 'art'],
  [/\bmedicine\b|\bmedical school\b/i, 'medicine'],
];

/**
 * The Yale single-discipline-school token a source URL's host names, drawn from the
 * subdomain label immediately preceding `yale.edu` (`faculty.som.yale.edu` ->
 * `management`). Only reliably single-discipline hosts
 * (`CONTRADICTION_SOURCE_SUBDOMAINS`) resolve; medical-campus and science-adjacent
 * hosts, unmapped subdomains, and non-Yale hosts return null so they never gate.
 */
function yaleSchoolTokenFromUrl(value: unknown): string | null {
  const urlText = textValue(value);
  if (!urlText) return null;
  let hostname: string;
  try {
    hostname = new URL(urlText).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!/(^|\.)yale\.edu$/i.test(hostname)) return null;
  const label =
    hostname
      .replace(/\.yale\.edu$/i, '')
      .split('.')
      .filter(Boolean)
      .at(-1) || '';
  if (!CONTRADICTION_SOURCE_SUBDOMAINS.has(label)) return null;
  return YALE_SCHOOL_TOKEN_BY_SUBDOMAIN[label] || null;
}

/**
 * The set of Yale professional-school tokens an entity's own recorded school and
 * departments name. Liberal matching is deliberately fail-open: extra tokens only
 * make a school contradiction less likely to fire, never more, so a spurious match
 * can never cause a wrong rejection.
 */
function yaleSchoolTokensFromEntity(entity: ResearchEntityIdentity): Set<string> {
  const text = [
    textValue(entity.school),
    ...(Array.isArray(entity.schools) ? entity.schools.map(textValue) : []),
    ...(Array.isArray(entity.departments) ? entity.departments.map(textValue) : []),
  ]
    .filter(Boolean)
    .join(' ');
  const tokens = new Set<string>();
  for (const [pattern, token] of YALE_SCHOOL_TOKEN_KEYWORDS) {
    if (pattern.test(text)) tokens.add(token);
  }
  return tokens;
}

// Yale Law School and the School of Management routinely cross-appoint the same
// faculty (law-and-economics, corporate governance, financial regulation), so a
// School of Management entity's own bio living at law.yale.edu (or vice versa) is
// not a homonym collision - it is the entity's own page. Unlike the
// TOLERANT_DIVERGENT_SCHOOL_SUBDOMAINS hosts, which stay soft-only pending an
// independent-page check (issue #1413's same-name-different-person risk), this
// specific pair carries no such name-collision precedent, so it is exempted from
// the hard contradiction outright rather than merely downgraded to a soft signal.
const CROSS_APPOINTMENT_COMPATIBLE_SCHOOL_PAIRS = new Set(['law:management', 'management:law']);

/**
 * Whether a source URL's Yale school subdomain affirmatively contradicts the
 * school the entity itself records. Two people who share an exact full name but
 * belong to different Yale schools (a School of Management operations professor
 * and a School of Medicine grant-shell PI, both "Sang Kim") pass every name-token
 * check; only their schools disagree. A contradiction fires only when both the
 * URL host and the entity resolve to known-but-different schools, so a
 * discipline-neutral host or an entity with no recorded school never gates
 * (issue #1045, generalizing the medicine-host guard behind #585). A known
 * cross-appointment-compatible pair (Law/Management) is never a contradiction.
 */
export function sourceUrlSchoolContradictsEntity(
  value: unknown,
  entity: ResearchEntityIdentity,
): boolean {
  const urlSchool = yaleSchoolTokenFromUrl(value);
  if (!urlSchool) return false;
  const entitySchools = yaleSchoolTokensFromEntity(entity);
  if (entitySchools.size === 0) return false;
  if (entitySchools.has(urlSchool)) return false;
  for (const entitySchool of entitySchools) {
    if (CROSS_APPOINTMENT_COMPATIBLE_SCHOOL_PAIRS.has(`${urlSchool}:${entitySchool}`)) return false;
  }
  return true;
}

// medicine.yale.edu, ysph.yale.edu, and seas.yale.edu are excluded from
// CONTRADICTION_SOURCE_SUBDOMAINS because they legitimately host cross-appointed
// faculty whose primary school is elsewhere, so a page there must never be a hard
// contradiction. But that same tolerance is what let an exact full-name homonym
// through in issue #1413 (a CS professor's medicine.yale.edu namesake, and the
// mirror-image case of a medical professor's seas.yale.edu namesake): a full
// given+family name match at one of these hosts is treated as strong identity
// evidence even though it is exactly the shape a same-name-different-person
// collision takes. Requiring extra corroboration only in that narrow shape
// (full name match, tolerant host, entity's own school known and different)
// closes the gap without reintroducing a hard, one-directional rejection.
const TOLERANT_DIVERGENT_SCHOOL_SUBDOMAINS: ReadonlyMap<string, string> = new Map([
  ['medicine', 'medicine'],
  ['ysph', 'public-health'],
  ['publichealth', 'public-health'],
  ['seas', 'engineering'],
]);

function toleratedSchoolTokenFromUrl(value: unknown): string | null {
  const urlText = textValue(value);
  if (!urlText) return null;
  let hostname: string;
  try {
    hostname = new URL(urlText).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!/(^|\.)yale\.edu$/i.test(hostname)) return null;
  const label =
    hostname
      .replace(/\.yale\.edu$/i, '')
      .split('.')
      .filter(Boolean)
      .at(-1) || '';
  return TOLERANT_DIVERGENT_SCHOOL_SUBDOMAINS.get(label) || null;
}

/**
 * Whether a source URL comes from a cross-appointment-tolerant Yale school host
 * whose implied school nonetheless diverges from the entity's own recorded,
 * known school. Unlike `sourceUrlSchoolContradictsEntity`, this is deliberately
 * a soft signal (used only to require corroboration, never to hard-reject) so a
 * genuinely cross-appointed person is never blocked outright.
 */
export function sourceUrlToleratedSchoolDivergesFromEntity(
  value: unknown,
  entity: ResearchEntityIdentity,
): boolean {
  const urlSchool = toleratedSchoolTokenFromUrl(value);
  if (!urlSchool) return false;
  const entitySchools = yaleSchoolTokensFromEntity(entity);
  if (entitySchools.size === 0) return false;
  return !entitySchools.has(urlSchool);
}

// medicine, public-health, environment, engineering, and nursing routinely
// cross-appoint the same faculty across each other (a School of Public Health
// biostatistician or a School of the Environment scientist commonly also
// carries a medicine.yale.edu page) - this is the same rationale that already
// excludes all five from CONTRADICTION_SOURCE_SUBDOMAINS above. Membership in
// this cluster on the entity's side confirms a tolerant host's implied school
// even when the two tokens are not identical.
const SCIENCE_HEALTH_CROSS_APPOINTMENT_CLUSTER = new Set([
  'medicine',
  'public-health',
  'environment',
  'engineering',
  'nursing',
]);

/**
 * Whether a tolerant host's implied school is affirmatively CONFIRMED to match
 * one of the entity's own recorded schools/departments, directly or via the
 * mutual-cross-appointment cluster above. Unlike
 * `sourceUrlToleratedSchoolDivergesFromEntity` (which fails open - "unknown
 * school" is treated as "assume fine", so a full-name match at a tolerant host
 * is never blocked outright when the entity's own school isn't recorded), this
 * fails closed: an unmapped or unknown entity school - e.g. a Faculty of Arts
 * and Sciences department like "Russian, East European, and Eurasian Studies"
 * that never matches any `YALE_SCHOOL_TOKEN_KEYWORDS` pattern - counts as NOT
 * confirmed. Used only for the weaker surname-only match (#1537), where there is
 * no given-name evidence at all to fall back on, so the corroboration
 * requirement must trigger by default rather than only on affirmative
 * divergence - a genuinely medicine-department "<Surname> Lab" is spared
 * (confirmed match), while a humanities-department "<Surname> Lab" is not
 * spared just because its department happens to be unmapped.
 */
function sourceUrlToleratedSchoolConfirmedForEntity(
  value: unknown,
  entity: ResearchEntityIdentity,
): boolean {
  const urlSchool = toleratedSchoolTokenFromUrl(value);
  if (!urlSchool) return false;
  const entitySchools = yaleSchoolTokensFromEntity(entity);
  if (entitySchools.has(urlSchool)) return true;
  if (!SCIENCE_HEALTH_CROSS_APPOINTMENT_CLUSTER.has(urlSchool)) return false;
  for (const entitySchool of entitySchools) {
    if (SCIENCE_HEALTH_CROSS_APPOINTMENT_CLUSTER.has(entitySchool)) return true;
  }
  return false;
}

/**
 * Whether the entity records ANY school/department string at all, mapped or
 * not. Gates the surname-only corroboration requirement below: an entity with
 * a recorded-but-unmapped department (Graham Lab's "Russian, East European,
 * and Eurasian Studies") still carries a real, if undecodable, domain claim
 * that a medicine.yale.edu surname match should be checked against. An entity
 * with NO school/department recorded at all carries no such claim to check
 * against, so treating it the same as a known-different school would reject
 * every surname-only match for every entity that simply never had its
 * department populated - far broader than the coincidental-homonym shape
 * this is meant to catch, and exactly the case a real "<Surname> Lab" whose
 * own recorded `website` names its own PI (issue #1537's Ashford Lab
 * regression test) must still pass unconditionally.
 */
function hasAnyRecordedSchoolInfo(entity: ResearchEntityIdentity): boolean {
  if (textValue(entity.school)) return true;
  if (Array.isArray(entity.schools) && entity.schools.some((school) => textValue(school))) {
    return true;
  }
  if (
    Array.isArray(entity.departments) &&
    entity.departments.some((department) => textValue(department))
  ) {
    return true;
  }
  return false;
}

function normalizeUrlForCompare(value: string): string {
  return value.trim().toLowerCase().replace(/\/+$/, '');
}

function distinctTokensPresent(tokens: string[], present: Set<string>): number {
  let count = 0;
  for (const token of new Set(tokens)) if (present.has(token)) count += 1;
  return count;
}

/**
 * The person-name tokens the entity's own descriptive prose carries, drawn from its
 * `fullDescription` and each `recentGrants` title/abstract. Used only to corroborate
 * a page whose name did not match the entity's name/slug, so credential tokens are
 * dropped and short tokens are excluded to keep the corroboration name-shaped.
 */
function entityProseNameTokens(entity: ResearchEntityIdentity): Set<string> {
  const parts = [textValue(entity.fullDescription)];
  if (Array.isArray(entity.recentGrants)) {
    for (const grant of entity.recentGrants) {
      parts.push(textValue(grant?.title), textValue(grant?.abstract));
    }
  }
  const tokens = new Set<string>();
  for (const token of parts
    .join(' ')
    .toLowerCase()
    .split(/[^a-z]+/i)) {
    if (token.length >= 2 && !CREDENTIAL_TOKENS.has(token)) tokens.add(token);
  }
  return tokens;
}

/**
 * Whether an entity's own recorded evidence independently names the person a
 * source URL points to, even though that name never appears in the entity's name
 * or slug. A topic-named grant shell ("Yale Reproductive Ecology Laboratory",
 * slug `nsf-pi-<objectId>`) never carries its PI's personal name in its name/slug,
 * so `personProfileSourceMatchesEntity`'s token check can never match the shell's
 * own legitimate PI profile page; this recovers that case (issue #1110). Two
 * independent signals corroborate, each requiring the full person (>= 2 shared name
 * tokens, i.e. first and last) so a single mis-picked wrong-professor page (#688)
 * can never satisfy them: the entity's own prose (`fullDescription`/`recentGrants`)
 * names the same person, or the same person appears on two or more of the entity's
 * other recorded `sourceUrls`.
 */
/**
 * How many of an entity's OTHER recorded `sourceUrls` are themselves name-shaped
 * Yale person pages naming the same full person as `urlTokens`, excluding the
 * candidate URL itself. Deliberately independent of the entity's own prose: a
 * full-name-match entity's `fullDescription` trivially names its own person by
 * construction, so counting prose here would corroborate a same-name graft as
 * readily as a genuine match.
 */
function independentCorroboratingSourcePageCount(
  urlTokens: string[],
  value: unknown,
  entity: ResearchEntityIdentity,
): number {
  const sourceUrls = Array.isArray(entity.sourceUrls)
    ? entity.sourceUrls.map(textValue).filter(Boolean)
    : [];
  const candidateUrl = normalizeUrlForCompare(textValue(value));
  let corroboratingPages = 0;
  for (const sourceUrl of sourceUrls) {
    if (normalizeUrlForCompare(sourceUrl) === candidateUrl) continue;
    const otherTokens = personProfileNameTokensFromUrl(sourceUrl);
    if (otherTokens && distinctTokensPresent(urlTokens, new Set(otherTokens)) >= 2) {
      corroboratingPages += 1;
    }
  }
  return corroboratingPages;
}

/**
 * The name tokens of every OTHER cited Yale person page whose person the entity's
 * own identity names in full - both a family name and a given name - so the page is
 * the entity's own person's rather than a same-surname colleague's.
 *
 * This is the owner of the entity's person-page slot. A surname-only overlap says
 * nothing about which of two same-surname people a page belongs to, but an entity
 * that already cites the full-name page of the person it is named after has
 * answered that question with its own evidence.
 */
function citedIdentityNamedPersonPages(
  value: unknown,
  entity: ResearchEntityIdentity,
  identityTokens: string[],
): string[][] {
  const candidateUrl = normalizeUrlForCompare(textValue(value));
  const cited = Array.isArray(entity.citedPersonPageUrls)
    ? entity.citedPersonPageUrls
    : Array.isArray(entity.sourceUrls)
      ? entity.sourceUrls
      : [];
  const owners: string[][] = [];
  for (const sourceUrl of cited) {
    const url = textValue(sourceUrl);
    if (!url || normalizeUrlForCompare(url) === candidateUrl) continue;
    const tokens = personProfileNameTokensFromUrl(url);
    if (!tokens) continue;
    const familyMatches = tokens
      .slice(1)
      .some((token) => identityTokens.some((identityToken) => tokensOverlap(token, identityToken)));
    const givenMatches = identityTokens.some((identityToken) =>
      tokensOverlap(tokens[0], identityToken),
    );
    if (familyMatches && givenMatches) owners.push(tokens);
  }
  return owners;
}

/**
 * Whether the entity's own citations already name the owner of its person-page
 * slot, and that owner is a different person from the one this page is about.
 *
 * The comparison is page slug against page slug, never slug against the entity's
 * title. That distinction is what makes this safe where a similarity rule is not:
 * a department's slug routinely spells a person's middle name, short form,
 * preferred name or a misspelling, so an entity titled for one person legitimately
 * cites a page whose slug carries a different given name. Measured on Development,
 * the narrowest title-versus-slug rule fired on 7 served rows and the pages' own
 * rendered names showed 4 of the 7 were the entity's own person. Every one of those
 * 4 cited exactly one person page, so a rule that fires only when a second,
 * identity-named page is already cited leaves them alone.
 *
 * Both given-name tables are unioned (`givenNamesAgree`) because here agreement is
 * what SPARES the candidate, so the risk runs the other way from the repair lanes:
 * a variant listed in neither table produces no agreement and the page is refused,
 * even when it is the row's own person's page under a short form or an initials
 * slug. Unioning the tables can therefore only narrow this refusal, never widen it,
 * and widening the arm itself means widening the tables first.
 *
 * It follows that this can never take a row's only person-page citation, which is
 * the failure #2385 records: the owner page it reasons from stays cited.
 */
function citedOwnerNamesADifferentPerson(
  value: unknown,
  entity: ResearchEntityIdentity,
  identityTokens: string[],
  urlTokens: string[],
): boolean {
  const owners = citedIdentityNamedPersonPages(value, entity, identityTokens);
  if (owners.length === 0) return false;
  return !owners.some(
    (ownerTokens) =>
      ownerTokens.some((ownerToken) => givenNamesAgree(urlTokens[0], ownerToken)) ||
      urlTokens.some((urlToken) => givenNamesAgree(urlToken, ownerTokens[0])),
  );
}

/**
 * Whether a person page belongs to somebody other than the person the entity's own
 * citations already establish as its own: the owner-arbitrated arm of
 * `personProfileSourceMatchesEntity` on its own, without the school arms.
 *
 * A projection that mints a citation asks only "is this somebody else", so it reads
 * this rather than the wider predicate. Wiring the wider one into the `sourceUrls`
 * projections was measured on Development and refused 11 served rows their own
 * person's page, emptying one row entirely: on Yale's shared CMS a
 * `medicine.yale.edu/profile/<slug>` page for an engineering or architecture
 * professor is a routine cross-appointment rather than a homonym, which is the same
 * failure #2570 records for prose.
 */
export function personProfileSourceIsADifferentPersonThanCitedOwner(
  value: unknown,
  entity: ResearchEntityIdentity,
): boolean {
  const urlTokens = personProfileNameTokensFromUrl(value);
  if (!urlTokens) return false;
  const identityTokens = researchEntityIdentityTokens(entity);
  if (identityTokens.length === 0) return false;
  const familyNameMatches = urlTokens
    .slice(1)
    .some((token) => identityTokens.some((identityToken) => tokensOverlap(token, identityToken)));
  if (!familyNameMatches) return false;
  if (identityTokens.some((identityToken) => tokensOverlap(urlTokens[0], identityToken))) {
    return false;
  }
  return citedOwnerNamesADifferentPerson(value, entity, identityTokens, urlTokens);
}

function entityCorroboratesPersonProfile(
  urlTokens: string[],
  value: unknown,
  entity: ResearchEntityIdentity,
): boolean {
  if (distinctTokensPresent(urlTokens, entityProseNameTokens(entity)) >= 2) return true;
  return independentCorroboratingSourcePageCount(urlTokens, value, entity) >= 2;
}

/**
 * Whether a description-source URL may be attributed to an entity. A URL that is
 * not a name-shaped Yale person page is always allowed (it carries no checkable
 * person name). A name-shaped person page is allowed only when at least one of its
 * name tokens overlaps the entity identity; a page whose person shares no token
 * with the entity (a different professor entirely, e.g. `keith-baker` under
 * `dept-physics-charles-brown`) is rejected so its content never keys onto the
 * wrong entity, unless the entity's own recorded evidence independently names that
 * same person (a topic-named grant shell whose PI never appears in its name/slug,
 * issue #1110). A shared family name (any URL name token after the leading given
 * name) is a strong enough match to attribute; a shared given name alone is not,
 * because unrelated people routinely share a first name ("Benjamin" Polak vs
 * "Benjamin" Kelmendi, issue #981), so a given-name-only overlap falls through to
 * the same full-person corroboration the no-token case uses and is rejected unless
 * the entity's own evidence independently names that person. A surname collision
 * (a shared family name with differing given names) stays allowed and is left to
 * identity/dedupe resolution *when the entity's own identity carries a given name
 * at all* (even one that disagrees with the URL's, e.g. "Perry" Lowell vs
 * "Frances" Lowell) - that disagreement is itself evidence the entity already
 * claims a specific person - UNLESS the entity's own citations already name the
 * owner of its person-page slot and that owner is somebody else
 * (`citedOwnerNamesADifferentPerson`, #2945). The entity's title cannot arbitrate a
 * surname collision, because a department slug routinely spells a middle name, a
 * short form, a preferred name or a misspelling of the person the entity is about;
 * a second cited page whose person the identity names in full can, and by
 * construction it leaves the row that citation.
 * When the entity's identity is a bare single surname
 * token with no given name anywhere (a department-roster-derived "<Surname> Lab"
 * whose real given name was never recorded) AND the entity records SOME
 * school/department (even one that maps to no known token), that same
 * surname-only overlap at a cross-appointment-tolerant host carries no
 * disambiguating evidence at all - it is exactly the shape of a coincidental
 * homonym (issue #1537, e.g. a Russian and East European Studies "Graham Lab"
 * keyed onto a School of Medicine medicine.yale.edu/profile/thomas-graham
 * page) - so it requires an independent corroborating page, same as a
 * no-token-match; unlike a no-token-match it deliberately excludes prose
 * corroboration, because a surname-only entity's own fullDescription - when
 * populated from this very page, e.g. an LLM-confabulated medical reframe of a
 * same-surname humanities professor - would trivially name whichever person the
 * disputed page describes and so can never independently corroborate it (issue
 * #1671, e.g. a School of Art "Crewdson Lab" keyed onto a different Gregory
 * Crewdson's medicine.yale.edu profile). An entity with no recorded
 * school/department at all is left alone here (it carries no domain claim to
 * check the URL against), so a legitimate "<Surname> Lab" whose own recorded
 * website names its own PI by full name still passes unconditionally. A URL
 * whose Yale school subdomain contradicts the entity's own recorded school is
 * always rejected first, so an exact full-name homonym at a different Yale
 * school (issue #1045) is ruled out even when every name token matches. An
 * exact full-name match (given name and family name both overlap) at a
 * cross-appointment-tolerant host (medicine, public health, engineering) whose
 * implied school diverges from the entity's own recorded school likewise
 * requires an independent corroborating page rather than prose, so the
 * same-name-different-person collision those tolerant hosts otherwise let
 * through (issue #1413) is caught symmetrically in either direction.
 */
/**
 * Whether a cited person page names a person the entity's own identity shares NO
 * name token with - a different professor entirely, the #688 shape.
 *
 * This is the narrow arm of `personProfileSourceMatchesEntity`, without its
 * same-name-homonym arms (the school contradiction and the tolerant-host
 * divergence). Those require independent corroboration for a page whose person
 * DOES match by name, which on Yale's shared CMS refuses a genuine
 * cross-appointment: `medicine.yale.edu/profile/<slug>` hosts faculty of
 * architecture, management, public health and music, so a divergent host is
 * routine rather than evidence of a homonym. Measured on Development, retiring
 * stored descriptions on the wider rule took the served prose off three rows
 * whose page was demonstrably their own person's, so a lane that wants only "this
 * is somebody else" asks for this instead (#2570).
 */
export function personProfileSourceNamesADifferentPerson(
  value: unknown,
  entity: ResearchEntityIdentity,
): boolean {
  const urlTokens = personProfileNameTokensFromUrl(value);
  if (!urlTokens) return false;
  const identityTokens = researchEntityIdentityTokens(entity);
  if (identityTokens.length === 0) return false;
  const anyTokenMatches = urlTokens.some((urlToken) =>
    identityTokens.some((identityToken) => tokensOverlap(urlToken, identityToken)),
  );
  if (anyTokenMatches) return false;
  return !entityCorroboratesPersonProfile(urlTokens, value, entity);
}

export function personProfileSourceMatchesEntity(
  value: unknown,
  entity: ResearchEntityIdentity,
): boolean {
  if (sourceUrlSchoolContradictsEntity(value, entity)) return false;
  const urlTokens = personProfileNameTokensFromUrl(value);
  if (!urlTokens) return true;
  const identityTokens = researchEntityIdentityTokens(entity);
  if (identityTokens.length === 0) return true;
  const givenNameToken = urlTokens[0];
  const familyNameTokens = urlTokens.slice(1);
  const familyNameMatches = familyNameTokens.some((urlToken) =>
    identityTokens.some((identityToken) => tokensOverlap(urlToken, identityToken)),
  );
  if (familyNameMatches) {
    const givenNameAlsoMatches = identityTokens.some((identityToken) =>
      tokensOverlap(givenNameToken, identityToken),
    );
    if (
      !givenNameAlsoMatches &&
      citedOwnerNamesADifferentPerson(value, entity, identityTokens, urlTokens)
    ) {
      return false;
    }
    if (
      !givenNameAlsoMatches &&
      identityTokens.length === 1 &&
      toleratedSchoolTokenFromUrl(value) !== null &&
      hasAnyRecordedSchoolInfo(entity) &&
      !sourceUrlToleratedSchoolConfirmedForEntity(value, entity)
    ) {
      // The entity records no given name to disambiguate against, so its own
      // prose - if ever populated from this same contested page - would trivially
      // name whichever person that page describes; only an independent second
      // page (never this page's own confabulated description) counts (#1671).
      return independentCorroboratingSourcePageCount(urlTokens, value, entity) >= 2;
    }
    if (givenNameAlsoMatches && sourceUrlToleratedSchoolDivergesFromEntity(value, entity)) {
      // The entity's own prose trivially names itself (it IS this person's page),
      // so prose can never distinguish this profile from a same-full-name
      // homonym at a different school; only an independent second page counts.
      return independentCorroboratingSourcePageCount(urlTokens, value, entity) >= 2;
    }
    return true;
  }
  return entityCorroboratesPersonProfile(urlTokens, value, entity);
}
