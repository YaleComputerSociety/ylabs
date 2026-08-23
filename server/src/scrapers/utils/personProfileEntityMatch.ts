import { normalizeName, slugify } from './scraperHelpers';

export interface ResearchEntityIdentity {
  slug?: string;
  name?: string;
  displayName?: string;
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

/**
 * Whether a description-source URL may be attributed to an entity. A URL that is
 * not a name-shaped Yale person page is always allowed (it carries no checkable
 * person name). A name-shaped person page is allowed only when at least one of its
 * name tokens overlaps the entity identity; a page whose person shares no token
 * with the entity (a different professor entirely, e.g. `keith-baker` under
 * `dept-physics-charles-brown`) is rejected so its content never keys onto the
 * wrong entity. Ambiguous partial matches (a shared first name or surname) are
 * allowed and left to identity/dedupe resolution, so the guard never fabricates a
 * conflation from a name it cannot rule out.
 */
export function personProfileSourceMatchesEntity(
  value: unknown,
  entity: ResearchEntityIdentity,
): boolean {
  const urlTokens = personProfileNameTokensFromUrl(value);
  if (!urlTokens) return true;
  const identityTokens = researchEntityIdentityTokens(entity);
  if (identityTokens.length === 0) return true;
  return urlTokens.some((urlToken) =>
    identityTokens.some((identityToken) => tokensOverlap(urlToken, identityToken)),
  );
}
