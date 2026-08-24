import { normalizeName, slugify } from './scraperHelpers';

export interface ResearchEntityIdentity {
  slug?: string;
  name?: string;
  displayName?: string;
  school?: string;
  schools?: string[];
  departments?: string[];
  sourceUrls?: string[];
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
  const urlText = textValue(value);
  if (!urlText) return null;
  let url: URL;
  try {
    url = new URL(urlText);
  } catch {
    return null;
  }
  if (!/(^|\.)yale\.edu$/i.test(url.hostname)) return null;
  const match = url.pathname.match(/^\/(?:people|profile)\/([^/]+)\/?$/i);
  if (!match) return null;
  const rawSlug = match[1];
  if (/\d/.test(rawSlug)) return null;
  const tokens = rawSlug
    .toLowerCase()
    .split(/[^a-z]+/i)
    .filter((token) => token.length >= 2 && !CREDENTIAL_TOKENS.has(token));
  if (tokens.some((token) => ROSTER_PAGE_WORDS.has(token))) return null;
  return tokens.length >= 2 ? tokens : null;
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
  const label = hostname.replace(/\.yale\.edu$/i, '').split('.').filter(Boolean).at(-1) || '';
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

/**
 * Whether a source URL's Yale school subdomain affirmatively contradicts the
 * school the entity itself records. Two people who share an exact full name but
 * belong to different Yale schools (a School of Management operations professor
 * and a School of Medicine grant-shell PI, both "Sang Kim") pass every name-token
 * check; only their schools disagree. A contradiction fires only when both the
 * URL host and the entity resolve to known-but-different schools, so a
 * discipline-neutral host or an entity with no recorded school never gates
 * (issue #1045, generalizing the medicine-host guard behind #585).
 */
export function sourceUrlSchoolContradictsEntity(
  value: unknown,
  entity: ResearchEntityIdentity,
): boolean {
  const urlSchool = yaleSchoolTokenFromUrl(value);
  if (!urlSchool) return false;
  const entitySchools = yaleSchoolTokensFromEntity(entity);
  if (entitySchools.size === 0) return false;
  return !entitySchools.has(urlSchool);
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
  const label = hostname.replace(/\.yale\.edu$/i, '').split('.').filter(Boolean).at(-1) || '';
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
  for (const token of parts.join(' ').toLowerCase().split(/[^a-z]+/i)) {
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
 * claims a specific person. When the entity's identity is a bare single surname
 * token with no given name anywhere (a department-roster-derived "<Surname> Lab"
 * whose real given name was never recorded) AND the entity records SOME
 * school/department (even one that maps to no known token), that same
 * surname-only overlap at a cross-appointment-tolerant host carries no
 * disambiguating evidence at all - it is exactly the shape of a coincidental
 * homonym (issue #1537, e.g. a Russian and East European Studies "Graham Lab"
 * keyed onto a School of Medicine medicine.yale.edu/profile/thomas-graham
 * page) - so it requires the same corroboration as a no-token-match. An
 * entity with no recorded school/department at all is left alone here (it
 * carries no domain claim to check the URL against), so a legitimate
 * "<Surname> Lab" whose own recorded website names its own PI by full name
 * still passes unconditionally. A URL whose Yale school subdomain
 * contradicts the entity's own recorded school is always rejected first, so an
 * exact full-name homonym at a different Yale school (issue #1045) is ruled out
 * even when every name token matches. An exact full-name match (given name and
 * family name both overlap) at a cross-appointment-tolerant host (medicine,
 * public health, engineering) whose implied school diverges from the entity's own
 * recorded school still requires the same corroboration as a no-token-match, so
 * the same-name-different-person collision those tolerant hosts otherwise let
 * through (issue #1413) is caught symmetrically in either direction.
 */
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
      identityTokens.length === 1 &&
      toleratedSchoolTokenFromUrl(value) !== null &&
      hasAnyRecordedSchoolInfo(entity) &&
      !sourceUrlToleratedSchoolConfirmedForEntity(value, entity)
    ) {
      return entityCorroboratesPersonProfile(urlTokens, value, entity);
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
