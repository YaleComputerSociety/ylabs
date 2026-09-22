/**
 * Shared hygiene for scraped person NAMES.
 *
 * Sibling of `titleHygiene`, which governs the short person `title` field, and of
 * `personNameLifespan`, which strips a trailing birth-death range. This module
 * governs the rest of the furniture a profile-page selector can lift into a name
 * field, where only a person's name belongs.
 *
 * Four shapes were measured on the student-served roster and are cleaned:
 *
 *   - an image caption used as the name ("Photo of <name>."), which happens when
 *     the selector reaches the portrait's alt text instead of the heading;
 *   - a post-nominal credential list appended after a comma ("<name>, PhD, MPH,
 *     FACE"), which a directory listing prints beside the name;
 *   - a shouty raw-cased name, already handled for `fname`/`lname` by
 *     `personNameCasing` but not for `displayName`;
 *   - a former-name annotation ("<name> f.k.a. <name>").
 *
 * A fifth shape, an underscored or dotted directory slug ("<surname>_<given>",
 * "<given>.<surname>"), is rejected rather than rewritten. It is not a name and
 * cannot be repaired into one: the slug does not say which token is the surname,
 * so title-casing it would serve a confidently wrong name instead of a visibly
 * broken one.
 *
 * Every rule is anchored so it cannot fire on a real name. The credential rules
 * require the comma, because a post-nominal with no separator ("Ruffing RSM")
 * cannot be told from a surname; a generational suffix ("Jr.", "III") and an
 * inverted "Surname, Given" both pass through. The casing rule is the one that had
 * to be taught restraint rather than reach: title-casing every all-caps run turned
 * an unlisted credential into "Mha" and a deliberately capitalized surname into
 * "Pham", so a trailing short all-caps token on an otherwise mixed-case name is
 * left exactly as the source wrote it.
 */
import {
  canonicalPersonName,
  GENERATIONAL_NAME_SUFFIX_TOKENS,
} from '../scrapers/utils/personNameCasing';

const SHOUTY_SURNAME_PARTICLES = new Set([
  'DE',
  'DEL',
  'DELA',
  'DELLA',
  'DI',
  'DA',
  'DAS',
  'DOS',
  'DU',
  'DER',
  'DEN',
  'LA',
  'LE',
  'LO',
  'EL',
  'AL',
  'BIN',
  'IBN',
  'TER',
  'TEN',
  'VAN',
  'VON',
  'ZU',
  'ZUR',
]);

const isSurnameParticleToken = (token: string): boolean =>
  SHOUTY_SURNAME_PARTICLES.has(token.replace(/[.,]+$/, '').toUpperCase());

const hasLowercaseLetter = (value: string): boolean => /[a-z]/.test(value);

const CAPTION_LEAD_IN =
  /^(?:photo|photograph|portrait|picture|image|headshot|pic)\s+of\s+(?=\S)(.+)$/i;

const POST_NOMINAL_TOKEN = [
  'ph\\.?\\s?d',
  'm\\.?\\s?d',
  'dr\\.?\\s?p\\.?\\s?h',
  'm\\.?\\s?p\\.?\\s?h',
  'm\\.?\\s?s\\.?\\s?n',
  'm\\.?\\s?h\\.?\\s?s',
  'm\\.?\\s?s\\.?\\s?w',
  'm\\.?\\s?b\\.?\\s?a',
  'm\\.?\\s?p\\.?\\s?a',
  'm\\.?\\s?math',
  'm\\.?\\s?sc',
  'm\\.?\\s?phil',
  'm\\.?\\s?div',
  'm\\.?\\s?f\\.?\\s?a',
  'd\\.?\\s?f\\.?\\s?a',
  'd\\.?\\s?phil',
  'd\\.?\\s?v\\.?\\s?m',
  'd\\.?\\s?d\\.?\\s?s',
  'd\\.?\\s?n\\.?\\s?p',
  'd\\.?\\s?p\\.?\\s?t',
  'sc\\.?\\s?d',
  'ed\\.?\\s?d',
  'psy\\.?\\s?d',
  'll\\.?\\s?m',
  'j\\.?\\s?d',
  'cnm',
  'fnp',
  'aprn',
  'lpc',
  'face',
  'facp',
  'faap',
  'faan',
  'fasc',
  'frcp',
  'frcs',
  'r\\.?\\s?n',
  'd\\.?\\s?o',
  'm\\.?\\s?s',
  'm\\.?\\s?a',
  'p\\.?\\s?a\\.?-c',
].join('|');

/**
 * The vocabulary above can never be complete: Development alone holds MHA, LCSW,
 * LADC, MBBS, MHPE, MLS, FACMI and CHES after a comma. An unlisted credential is
 * worse than an unstripped one, because the casing pass then title-cases it into
 * "Mha", so a shape rule backs the list up: a trailing comma-run of all-caps
 * initialisms is a post-nominal run whatever the initialism spells.
 *
 * Guarded so it cannot eat an inverted all-caps "SURNAME, GIVEN". The name in front
 * of the run must hold two or more tokens that are not surname particles, so a
 * compound surname does not reach the token count a whole name would, and a
 * one-token run - the only shape an inverted given name can take - is a credential
 * only after a conventionally cased head with no particle in it. Refusing a run
 * costs a cosmetic credential; eating one deletes a given name.
 */
const ALL_CAPS_INITIALISM = '[A-Z]{2,6}(?:-[A-Z]{1,3})?\\.?';

// A directory prints a class year beside a degree ("MD '90"), which belongs to the
// credential run rather than to the name.
const CLASS_YEAR = "(?:\\s*'\\d{2})?";

const TRAILING_ALL_CAPS_RUN_RE = new RegExp(
  `,\\s*(?:${ALL_CAPS_INITIALISM}(?:[\\s,&]+${ALL_CAPS_INITIALISM}){0,3})${CLASS_YEAR}\\s*$`,
);

const TRAILING_CREDENTIAL_LIST_RE = new RegExp(
  `,\\s*(?:${POST_NOMINAL_TOKEN})\\.?(?:[\\s,&]+(?:${POST_NOMINAL_TOKEN})\\.?)*${CLASS_YEAR}\\s*$`,
  'i',
);

const AMBIGUOUS_BARE_POST_NOMINALS = new Set(['MA', 'MS', 'RN', 'DO', 'JD']);

/**
 * `nee` and `aka` are themselves real name elements - Ga "Nee", Japanese "Aka" - so
 * the bare spellings cannot anchor the rule: they would truncate "Kwame Nee Adjei"
 * to "Kwame". Only the marked spellings count, the accented "née" and a dotted
 * "a.k.a.". "fka" and "formerly" are not names in any tradition, so they need no
 * mark. A missed annotation is cosmetic; an eaten given name is not.
 */
const FORMER_NAME_ANNOTATION_RE =
  /[\s,]+(?:f\.?\s?k\.?\s?a\.?|a\.\s?k\.?\s?a\.?|a\s?k\s?a\.|formerly(?:\s+known\s+as)?|née|née)\s+\S.*$/i;

const UNDERSCORE_SLUG_RE = /_/;

const DOTTED_LOWERCASE_LOCAL_PART_RE = /^[a-z][a-z0-9'-]*(?:\.[a-z][a-z0-9'-]*)+$/;

export function stripPersonNameCaptionWrapper(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(CAPTION_LEAD_IN);
  if (!match) return trimmed;
  const inner = match[1].replace(/\s*\.\s*$/, '').trim();
  return inner || trimmed;
}

const NAME_TOKEN_COUNT_FOR_ALL_CAPS_RUN = 2;

const headTokensOf = (head: string): string[] => head.split(/\s+/).filter(Boolean);

/**
 * True when the text in front of a comma reads as one surname rather than a whole
 * name, which is the inverted directory form ("SURNAME, GIVEN"). Particles belong to
 * the surname they precede, so "DE LA CRUZ" is one surname while "JANE SMITH" is a
 * whole name and what follows its comma is therefore a credential run.
 *
 * Shared by the credential shape rule and the casing pass so the two cannot disagree
 * about which side of that line a value falls on.
 */
function headReadsAsLoneSurname(head: string): boolean {
  const tokens = headTokensOf(head);
  return (
    tokens.filter((token) => !isSurnameParticleToken(token)).length <
    NAME_TOKEN_COUNT_FOR_ALL_CAPS_RUN
  );
}

function allCapsRunTokens(run: string): string[] {
  return run
    .replace(/^,/, '')
    .replace(/'\d{2}\s*$/, '')
    .split(/[\s,&]+/)
    .map((token) => token.replace(/\.$/, ''))
    .filter(Boolean);
}

function strippedAllCapsCredentialRun(trimmed: string): string | undefined {
  const match = trimmed.match(TRAILING_ALL_CAPS_RUN_RE);
  if (!match || match.index === undefined) return undefined;
  const runTokens = allCapsRunTokens(match[0]);
  // A generational suffix is part of the name, and a directory prints it after a
  // comma exactly where a credential run sits ("<name>, III", "<name>, JR.").
  if (runTokens.some((token) => GENERATIONAL_NAME_SUFFIX_TOKENS.has(token))) return undefined;
  const head = trimmed
    .slice(0, match.index)
    .replace(/\s*,\s*$/, '')
    .trim();
  const headTokens = headTokensOf(head);
  // Counting particles as part of one surname, because a compound surname carries
  // the token count a whole name would ("DE LA CRUZ, MARIA" is inverted, not
  // credentialled), and a one-token run is the only shape an inverted given name
  // can take.
  if (headReadsAsLoneSurname(head)) return undefined;
  const headParticles = headTokens.filter(isSurnameParticleToken);
  if (runTokens.length === 1 && (headParticles.length > 0 || !hasLowercaseLetter(head))) {
    return undefined;
  }
  return head || undefined;
}

function strippedListedCredentialRun(trimmed: string): string | undefined {
  const match = trimmed.match(TRAILING_CREDENTIAL_LIST_RE);
  if (!match || match.index === undefined) return undefined;
  // A lone two-letter post-nominal is also a given name ("Ma"), and the inverted
  // "Surname, Given" form puts a given name exactly where a credential run sits,
  // so an ambiguous token has to be all-caps to read as a credential.
  const bare = match[0].replace(/^,/, '').replace(/[.,&\s]/g, '');
  if (AMBIGUOUS_BARE_POST_NOMINALS.has(bare.toUpperCase()) && bare !== bare.toUpperCase()) {
    return undefined;
  }
  return (
    trimmed
      .slice(0, match.index)
      .replace(/\s*,\s*$/, '')
      .trim() || undefined
  );
}

const MAX_CREDENTIAL_RUN_PASSES = 6;

/**
 * Applied repeatedly, because a run can mix a listed credential with an unlisted
 * one ("<name>, MD, PhD, MHA") and each rule only recognizes its own tail.
 */
export function stripPersonNameCredentialList(value: string): string {
  let current = value.trim();
  for (let pass = 0; pass < MAX_CREDENTIAL_RUN_PASSES; pass += 1) {
    const next = strippedListedCredentialRun(current) ?? strippedAllCapsCredentialRun(current);
    if (!next || next === current) return current;
    current = next;
  }
  return current;
}

export function stripPersonNameFormerNameAnnotation(value: string): string {
  const trimmed = value.trim();
  const stripped = trimmed.replace(FORMER_NAME_ANNOTATION_RE, '').trim();
  return stripped || trimmed;
}

/**
 * True when the value is a directory slug or an email local part rather than a
 * person's name. Both carry the tokens of a name but not the order or the casing,
 * so no rewrite can recover the name from them.
 */
export function isNonNamePersonIdentifier(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (UNDERSCORE_SLUG_RE.test(trimmed)) return true;
  return !/\s/.test(trimmed) && DOTTED_LOWERCASE_LOCAL_PART_RE.test(trimmed);
}

/**
 * A particle that is equally a given name in its own right ("Al Gore", "Di Stefano").
 * It only reads as a surname particle when something precedes it, so at the head of a
 * value it is left alone rather than lower-cased into a served name that opens in
 * lower case.
 *
 * The guard is positional and therefore covers the head only. A particle that is a
 * MIDDLE name - the Vietnamese "Van" in "NGUYEN VAN AN" - sits where a Dutch particle
 * sits ("JAN VAN BERG") and carries no signal that tells the two apart, so it is
 * still lower-cased. Dropping VAN from the set to protect it would mis-case every
 * shouting Dutch surname, which this corpus holds far more of.
 */
const GIVEN_NAME_AMBIGUOUS_PARTICLES = new Set(['AL', 'EL', 'DI', 'LO', 'VAN']);

/**
 * `personNameCasing` leaves a two-letter all-caps run alone, because it cannot be
 * told from a pair of initials, so a shouty compound surname keeps its particle
 * shouting ("DE GRAAF" reads as "DE Graaf" after title-casing the rest). A known
 * particle that is not the final token is a particle rather than initials, and a
 * particle is conventionally lower case.
 *
 * Keyed on the ALL-CAPS form only, and applied before title-casing, so a name a
 * source already capitalized conventionally ("Martin Van Buren") is left as its
 * owner spells it. Only a shouting source is corrected.
 */
function lowercaseShoutySurnameParticles(value: string): string {
  const tokens = value.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return value;
  return tokens
    .map((token, index) => {
      if (index === tokens.length - 1) return token;
      if (!SHOUTY_SURNAME_PARTICLES.has(token)) return token;
      if (index === 0 && GIVEN_NAME_AMBIGUOUS_PARTICLES.has(token)) return token;
      return token.toLowerCase();
    })
    .join(' ');
}

const TRAILING_SHORT_ALL_CAPS_TOKEN_RE = /^[A-Z]{2,6}\.?$/;

const NAME_LETTER_RUN_RE = /\p{L}+/gu;

/**
 * `canonicalPersonName` splits a value on whitespace and on intra-word hyphens and
 * apostrophes, so a shouty token that carries any other punctuation never reaches
 * its all-caps test ("BYRON," in the inverted directory form). Applying the same
 * rule to each letter run instead de-shouts those without widening what counts as
 * a name token.
 */
function canonicalNameLetterRuns(value: string): string {
  return value.replace(NAME_LETTER_RUN_RE, (run) => canonicalPersonName(run)).trim();
}

/**
 * A trailing short all-caps token on an otherwise mixed-case name is a
 * post-nominal the comma rule cannot see ("Janet K. Ruffing RSM") or a surname a
 * source deliberately capitalizes ("Nguyen Minh Thu PHAM"). Title-casing either
 * one is wrong, so it is left verbatim. When NOTHING in the name is lower case the
 * value is simply shouty and the whole of it is title-cased.
 */
function normalizeSegmentCasing(value: string): string {
  const tokens = value.split(/\s+/).filter(Boolean);
  const last = tokens.at(-1);
  if (
    tokens.length > 1 &&
    last &&
    TRAILING_SHORT_ALL_CAPS_TOKEN_RE.test(last) &&
    tokens.slice(0, -1).some(hasLowercaseLetter)
  ) {
    const head = canonicalNameLetterRuns(
      lowercaseShoutySurnameParticles(tokens.slice(0, -1).join(' ')),
    );
    return `${head} ${last}`.trim();
  }
  return canonicalNameLetterRuns(lowercaseShoutySurnameParticles(value));
}

/**
 * What follows a comma is re-cased only where it can only be a given name: the
 * inverted directory form, a wholly shouty value whose head reads as one surname
 * ("BYRON, ADA", "DE LA CRUZ, MARIA").
 *
 * Everywhere else a shouty run after a comma is a credential the strip rules
 * declined, and the casing pass has to decline it too: de-shouting it turns "LPC"
 * into "Lpc", "MBBS" into "Mbbs" and "DTM&H" into "Dtm&H", which is the exact harm
 * the all-caps shape rule was added to prevent. Shoutiness alone cannot tell the two
 * apart, because "JANE SMITH, MBBS" is as shouty as "BYRON, ADA"; only the head can,
 * which is why both rules ask `headReadsAsLoneSurname`. An unstripped credential is
 * cosmetic; a mangled one is a wrong string served as a person's name.
 */
function normalizeNameCasing(value: string): string {
  const commaIndex = value.indexOf(',');
  if (commaIndex < 0) return normalizeSegmentCasing(value);
  const head = value.slice(0, commaIndex);
  if (!hasLowercaseLetter(value) && headReadsAsLoneSurname(head)) {
    return normalizeSegmentCasing(value);
  }
  return `${normalizeSegmentCasing(head)}${value.slice(commaIndex)}`;
}

export type PersonNameNoiseShape =
  | 'caption-wrapper'
  | 'credential-list'
  | 'former-name-annotation'
  | 'shouty-casing'
  | 'non-name-identifier';

export function personNameNoiseShapes(value: string | null | undefined): PersonNameNoiseShape[] {
  if (typeof value !== 'string') return [];
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (!collapsed) return [];
  if (isNonNamePersonIdentifier(collapsed)) return ['non-name-identifier'];
  const shapes: PersonNameNoiseShape[] = [];
  const afterCaption = stripPersonNameCaptionWrapper(collapsed);
  if (afterCaption !== collapsed) shapes.push('caption-wrapper');
  const afterCredentials = stripPersonNameCredentialList(afterCaption);
  if (afterCredentials !== afterCaption) shapes.push('credential-list');
  const afterFormerName = stripPersonNameFormerNameAnnotation(afterCredentials);
  if (afterFormerName !== afterCredentials) shapes.push('former-name-annotation');
  if (normalizeNameCasing(afterFormerName) !== afterFormerName) shapes.push('shouty-casing');
  return shapes;
}

/**
 * Returns the name to store and serve, or `undefined` when the value is not a
 * person's name at all. Callers decide what `undefined` means for them: ingest
 * rejects the observation, and a repair pass leaves the stored value alone and
 * reports it, because blanking a lead's name would strip the lead rather than fix
 * it (#2385).
 */
export function sanitizePersonName(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (!collapsed) return undefined;
  if (isNonNamePersonIdentifier(collapsed)) return undefined;
  const cleaned = normalizeNameCasing(
    stripPersonNameFormerNameAnnotation(
      stripPersonNameCredentialList(stripPersonNameCaptionWrapper(collapsed)),
    ),
  );
  return cleaned || undefined;
}

export function personNameHasNoise(value: string | null | undefined): boolean {
  return personNameNoiseShapes(value).length > 0;
}
