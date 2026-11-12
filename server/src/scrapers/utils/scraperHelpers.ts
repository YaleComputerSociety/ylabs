/**
 * Shared, pure helpers for scraper implementations.
 *
 * Kept dependency-free (no I/O, no DB, no axios) so they're trivially unit-testable
 * and reusable across any scraper that needs to derive stable keys from messy
 * external data (names, emails, URLs).
 */
import { isDegreeToken, ROSTER_NAME_NORMALIZER_LEGACY_TOKENS } from '../../utils/degreeTokens';
import { stripInvisibleFormatCharacters } from '../../utils/invisibleFormatCharacters';
import {
  isPersonNameCaption,
  stripPersonNameCaptionWrapper,
  stripPersonNameCredentialList,
} from '../../utils/personNameHygiene';

export const SLUG_MAX_LENGTH = 100;

/**
 * Lowercase, ASCII-fold (basic), strip diacritics, and replace any run of
 * non-alphanumeric characters with a single dash. Trims leading/trailing dashes.
 *
 * Used to build deterministic entity keys from human-readable strings such as
 * faculty names or research-group names.
 *
 * Invisible format characters are stripped first because they are load-bearing for
 * identity here, not merely cosmetic: NFKD does not decompose U+00AD, so a CMS
 * soft hyphen survives into `[^a-z0-9]+` and becomes a dash. The same person keys
 * as `robin-read-er` on the hyphenated page and `robin-reader` everywhere else, and
 * the two keys never join (#2874).
 */
export function slugify(input: string): string {
  return unboundedSlug(input).slice(0, SLUG_MAX_LENGTH);
}

export function slugTokens(input: string): string[] {
  return unboundedSlug(input).split('-').filter(Boolean);
}

function unboundedSlug(input: string): string {
  if (!input) return '';
  return stripInvisibleFormatCharacters(input)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics
    .toLowerCase()
    .replace(/['\u2018\u2019]s\b/g, '') // drop possessive 's
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Extract the netid (local-part) from a Yale email address.
 *
 * Returns null if the input is not a Yale email or is malformed. The local-part
 * is lowercased and has any `+tag` suffix stripped. We deliberately *only* trust
 * @yale.edu emails since other domains can collide across institutions.
 */
export function netidFromEmail(email: string | undefined | null): string | null {
  if (!email) return null;
  const cleaned = String(email)
    .trim()
    .toLowerCase()
    .replace(/^mailto:/, '');
  const match = cleaned.match(/^([a-z0-9._-]+)(?:\+[a-z0-9._-]+)?@yale\.edu$/i);
  if (!match) return null;
  return match[1].toLowerCase();
}

function asciiTokens(input: string): string[] {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token && !/^\d+$/.test(token));
}

const ROLE_MAILBOX_TOKENS = new Set([
  'admin',
  'admissions',
  'chair',
  'communications',
  'communication',
  'contact',
  'dept',
  'department',
  'dgs',
  'dus',
  'editor',
  'events',
  'frontdesk',
  'info',
  'mailbox',
  'news',
  'no-reply',
  'noreply',
  'office',
  'reception',
  'registrar',
  'web',
  'webmaster',
  'website',
]);

function yaleEmailLocalPart(email: string | undefined | null): string | null {
  const cleaned = String(email || '')
    .trim()
    .toLowerCase()
    .replace(/^mailto:/, '');
  const match = cleaned.match(/^([a-z0-9._-]+)(?:\+[a-z0-9._-]+)?@yale\.edu$/i);
  return match ? match[1] : null;
}

function localPartTokens(localPart: string): string[] {
  return localPart.split(/[._-]+/).filter(Boolean);
}

/**
 * An office holder's mailbox is the office title followed by the holder's full name
 * (`dean.<first>.<last>`). The title alone stays a person's word, because Dean is a first
 * name and a surname too: `dean.<last>` and `<first>.dean` are personal addresses.
 */
const OFFICE_HOLDER_PREFIXES = new Set(['dean', 'provost']);

function localPartNamesAnOfficeHolderMailbox(tokens: readonly string[]): boolean {
  return tokens.length >= 3 && OFFICE_HOLDER_PREFIXES.has(tokens[0]);
}

export function localPartNamesARole(localPart: string): boolean {
  if (ROLE_MAILBOX_TOKENS.has(localPart)) return true;
  const tokens = localPartTokens(localPart);
  return (
    tokens.some((token) => ROLE_MAILBOX_TOKENS.has(token)) ||
    localPartNamesAnOfficeHolderMailbox(tokens)
  );
}

function yaleHostOf(pageUrl: string | undefined | null): string | null {
  try {
    const host = new URL(String(pageUrl || '')).hostname.toLowerCase();
    return host.endsWith('.yale.edu') ? host : null;
  } catch {
    return null;
  }
}

/**
 * The tokens a Yale unit is known by on the page an address was read from: the
 * leftmost label of a `*.yale.edu` host (`physics` for physics.yale.edu) and any
 * unit name or key the caller already holds for that page.
 */
export function yaleUnitMailboxTokens(
  pageUrls: ReadonlyArray<string | undefined | null>,
  unitNames: ReadonlyArray<string | undefined | null> = [],
): Set<string> {
  const tokens = new Set<string>();
  for (const pageUrl of pageUrls) {
    const host = yaleHostOf(pageUrl);
    if (!host) continue;
    const label = host.replace(/^www\./, '').split('.')[0];
    if (!label || label === 'yale') continue;
    tokens.add(label.replace(/-/g, ''));
    for (const part of label.split('-')) if (part) tokens.add(part);
  }
  for (const name of unitNames) {
    const slug = slugify(String(name || ''));
    if (!slug) continue;
    tokens.add(slug.replace(/-/g, ''));
    for (const part of slug.split('-')) if (part.length >= 3) tokens.add(part);
  }
  return tokens;
}

/**
 * A Yale address that belongs to an office rather than a person: its local part
 * names a role (`dus`, `registrar`, `office`), or consists only of the name of the
 * unit whose page printed it (`physics@yale.edu` on physics.yale.edu). Such an
 * address is printed on every member's profile page, so reading it as the person's
 * email mints one shared person key for everyone in the unit.
 */
export function isRoleOrUnitMailbox(
  email: string | undefined | null,
  unitTokens: ReadonlySet<string> = new Set(),
): boolean {
  const localPart = yaleEmailLocalPart(email);
  if (!localPart) return false;
  if (localPartNamesARole(localPart)) return true;
  if (unitTokens.size === 0) return false;
  if (unitTokens.has(localPart.replace(/[._-]+/g, ''))) return true;
  const tokens = localPartTokens(localPart);
  return tokens.length > 0 && tokens.every((token) => unitTokens.has(token));
}

const GENERATIONAL_SUFFIX_THEN_DIGITS = /^(?:jr|sr|ii|iii|iv)?\d*$/;

/**
 * The compacted local part is the person's whole name, in either order, optionally followed
 * by a generational suffix and digits (`firstlast`, `lastfirst2`, `firstlastjr`). A name
 * with another word fused before or after it (`physicsfirstlast`) is a glued extraction, not the person's own address (#5730).
 */
function isWholeNameLocalPart(compactLocalPart: string, compactNames: readonly string[]): boolean {
  return compactNames.some(
    (name) =>
      compactLocalPart.startsWith(name) &&
      GENERATIONAL_SUFFIX_THEN_DIGITS.test(compactLocalPart.slice(name.length)),
  );
}

/**
 * Return true only when a Yale email is plausibly owned by the supplied person.
 *
 * Yale pages sometimes include lab managers, admins, or departmental contacts
 * near a faculty name. Netid-shaped emails are safe enough to keep; name-shaped
 * local-parts must match the visible person name.
 */
export function isLikelyPersonSpecificYaleEmail(
  email: string | undefined | null,
  personName: string | undefined | null,
): boolean {
  const cleaned = String(email || '')
    .trim()
    .toLowerCase()
    .replace(/^mailto:/, '');
  const match = cleaned.match(/^([a-z0-9._-]+)(?:\+[a-z0-9._-]+)?@yale\.edu$/i);
  if (!match) return false;

  const localPart = match[1].toLowerCase();
  if (localPartNamesARole(localPart)) return false;

  if (/^[a-z]{2,6}\d{1,5}$/i.test(localPart)) return true;

  const emailTokens = asciiTokens(localPart);
  const nameTokens = asciiTokens(normalizeName(personName));
  if (emailTokens.length === 0 || nameTokens.length < 2) return false;

  const nameTokenSet = new Set(nameTokens);
  if (emailTokens.length >= 2 && emailTokens.every((token) => nameTokenSet.has(token))) {
    return true;
  }

  const lastName = nameTokens.at(-1) || '';
  const givenNames = nameTokens.slice(0, -1);
  if (!lastName || givenNames.length === 0) return false;

  const compactEmail = emailTokens.join('');
  const normalCompact = [...givenNames, lastName].join('');
  const reversedCompact = [lastName, ...givenNames].join('');
  if (isWholeNameLocalPart(compactEmail, [normalCompact, reversedCompact])) {
    return true;
  }

  if (emailTokens.length === 1 && emailTokens[0] === lastName && lastName.length >= 5) {
    return true;
  }

  if (
    !emailTokens.some(
      (token) => token === lastName || (lastName.length >= 4 && token.includes(lastName)),
    )
  ) {
    return false;
  }

  return givenNames.some((given) =>
    emailTokens.some(
      (token) =>
        token === given ||
        token.startsWith(given) ||
        given.startsWith(token) ||
        (given.length <= 2 && token.startsWith(given.charAt(0))) ||
        (token.length === 1 && given.startsWith(token)),
    ),
  );
}

/**
 * Normalize a faculty display name: collapse whitespace, strip trailing
 * credential suffixes (", Ph.D.", ", M.D.", etc.), remove leading honorifics,
 * and drop parenthetical nicknames ("Ruby (Hsin-Fang) Tu" -> "Ruby Tu").
 *
 * Returns the cleaned name suitable for slugification or display. Returns an
 * empty string on falsy input.
 */
export function normalizeName(
  name: string | undefined | null,
  credentialTokens: ReadonlySet<string> = ROSTER_NAME_NORMALIZER_LEGACY_TOKENS.v1,
): string {
  if (!name) return '';
  return normalizeNameKeepingCaption(
    stripPersonNameCaptionWrapper(collapseNameWhitespace(name)),
    credentialTokens,
  );
}

const photoSceneOpenerPattern =
  /^(?:an?\s+|the\s+)?(?:man|woman|person|people|group\s+of)\s+(?:in|with|wearing|holding|standing|sitting|seated|smiling|posing|playing|leaning|looking|on|at)\b/iu;
const photoSceneWordPattern =
  /(?<![\p{L}\p{N}])(?:wearing|holding|standing|sitting|seated|smiling|posing|playing|leaning|suit|shirt|jacket|glasses|background|in\s+front\s+of)(?![\p{L}\p{N}])/iu;

/**
 * Image alt text that describes the photo rather than naming the person in it: a scene
 * ("man in green suit holding guitar") or a caption ("Photo of Robin Fixture."). Either
 * one is the photo's text, never a name or a key, or the alt text becomes the person's
 * name and the research row's public slug (#5808). `normalizeName` strips a caption to
 * the name inside it, so a caller wanting that name reads it through `normalizeName`.
 */
export function isPhotoSceneDescription(text: string | undefined | null): boolean {
  const value = collapseNameWhitespace(String(text || ''));
  if (!value) return false;
  return (
    isPersonNameCaption(value) ||
    photoSceneOpenerPattern.test(value) ||
    photoSceneWordPattern.test(value)
  );
}

function collapseNameWhitespace(name: string): string {
  return stripInvisibleFormatCharacters(String(name)).replace(/\s+/g, ' ').trim();
}

/**
 * `normalizeName` without the headshot-caption rule: the form a roster row's slug and
 * user key were first minted from, before that rule existed, so identity continuity
 * can re-derive them unchanged (#4716).
 */
export function normalizeNameKeepingCaption(
  name: string | undefined | null,
  credentialTokens: ReadonlySet<string> = ROSTER_NAME_NORMALIZER_LEGACY_TOKENS.v1,
): string {
  if (!name) return '';
  let n = collapseNameWhitespace(name);
  // strip leading honorifics
  n = n.replace(/^(prof(\.|essor)?|dr\.?|mr\.?|mrs\.?|ms\.?|mx\.?)\s+/i, '');
  // drop parenthetical nicknames/asides e.g. "Ruby (Hsin-Fang) Tu" -> "Ruby Tu",
  // then clear any stray unmatched parenthesis left by upstream truncation
  n = n
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Strip trailing credential clauses after the last comma, repeating so that stacked
  // degrees collapse fully ("Avery Sloan, MD, PhD" -> "Avery Sloan"). A degree missing
  // from the list is not a cosmetic miss: the clause stays on the name and `splitName`
  // reads it as the surname (#2535). The default is the frozen version 1 list, because other
  // lanes derive keys from this name and have no key continuity; the roster lane passes the
  // shared list in `degreeTokens.ts` (#5969).
  for (;;) {
    const clause = n.match(/,\s*([^,]+?)\s*$/);
    if (!clause || clause.index === undefined || !isDegreeToken(clause[1], credentialTokens)) break;
    n = n.slice(0, clause.index);
  }
  // strip trailing parenthetical/credential-like trailing tokens
  n = n
    .trim()
    .replace(/[,;]+$/, '')
    .trim();
  return n;
}

/**
 * Ensure a single-letter initial that is immediately followed by a period keeps
 * a space before the next word, so "X.Liu" and "J.R.R. Example" render as
 * "X. Liu" and "J. R. R. Example". Whitespace runs are collapsed to single
 * spaces and the result is trimmed. An already-spaced initial ("X. Liu") is left
 * unchanged, and multi-word names without initials only have their whitespace
 * normalized.
 */
export function normalizeInitialSpacing(name: string | undefined | null): string {
  if (!name) return '';
  return String(name)
    .replace(/\s+/g, ' ')
    .replace(/\b([A-Za-z])\.(?=[A-Za-z])/g, '$1. ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Best-effort split of a normalized name into { first, last }.
 *
 * Handles single-word names (returns first only), suffixes like "Jr." / "III"
 * (treats them as part of the last name), and hyphenated last names. A trailing
 * credential list is dropped first, so a degree is never read as the surname. This is a
 * heuristic — production user records should rely on authoritative sources
 * (CAS / Yalies) rather than these splits.
 */
export function splitName(name: string): { first: string; last: string } {
  const tokens = stripPersonNameCredentialList(normalizeName(name)).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { first: '', last: '' };
  if (tokens.length === 1) return { first: tokens[0], last: '' };
  // pull off trailing suffix tokens like "Jr.", "Sr.", "II", "III", "IV"
  const suffixRe = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i;
  let lastIdx = tokens.length - 1;
  while (lastIdx > 1 && suffixRe.test(tokens[lastIdx])) lastIdx--;
  const first = tokens.slice(0, lastIdx).join(' ');
  const last = tokens.slice(lastIdx).join(' ');
  return { first, last };
}
