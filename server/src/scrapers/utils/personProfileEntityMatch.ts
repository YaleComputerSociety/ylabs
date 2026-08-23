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
  /^faculty-research-area-/,
  /^center-/,
];

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
function entityCorroboratesPersonProfile(
  urlTokens: string[],
  value: unknown,
  entity: ResearchEntityIdentity,
): boolean {
  if (distinctTokensPresent(urlTokens, entityProseNameTokens(entity)) >= 2) return true;
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
  return corroboratingPages >= 2;
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
 * issue #1110). Ambiguous partial matches (a shared first name or surname) are
 * allowed and left to identity/dedupe resolution, so the guard never fabricates a
 * conflation from a name it cannot rule out. A URL whose Yale school subdomain
 * contradicts the entity's own recorded school is always rejected first, so an
 * exact full-name homonym at a different Yale school (issue #1045) is ruled out
 * even when every name token matches.
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
  if (
    urlTokens.some((urlToken) =>
      identityTokens.some((identityToken) => tokensOverlap(urlToken, identityToken)),
    )
  ) {
    return true;
  }
  return entityCorroboratesPersonProfile(urlTokens, value, entity);
}
