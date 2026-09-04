/**
 * Whether a name harvested from a linked website may be adopted as a person's
 * research-home identity.
 *
 * Yale's profile content models expose a single "lab website" slot that faculty
 * populate with either their own lab or a center/clinic/collaborative they are
 * merely affiliated with, so a harvested name is evidence of affiliation and
 * not of identity. Adopting it verbatim is what named one professor's row after
 * an umbrella organization and grafted the same organization onto several
 * different people (issue #2234).
 */

const RESEARCH_HOME_LAB_HEAD_RE = /\b(?:lab|labs|laborator(?:y|ies)|groups?)\b/i;

const WORKING_GROUP_RE = /\bworking\s+group\b/i;

const UMBRELLA_ORGANIZATION_HEAD_RE =
  /\b(?:cent(?:er|re)s?|institutes?|programs?|programmes?|collaboratives?|clinics?|consorti(?:um|a)|units?|initiatives?|networks?|councils?|committees?|offices?|divisions?|departments?|sections?|schools?|colleges?|foundations?|societ(?:y|ies)|registr(?:y|ies)|alliances?|coalitions?|partnerships?|task\s+forces?|hospitals?|cores?|facilit(?:y|ies)|observator(?:y|ies)|museums?|librar(?:y|ies)|health\s+systems?)\b/i;

// A CMS link label is built entirely from generic navigation words, so a name
// made of nothing but these identifies no research home.
const LINK_LABEL_WORDS = new Set([
  'the',
  'a',
  'an',
  'my',
  'our',
  'lab',
  'labs',
  'laboratory',
  'laboratories',
  'research',
  'group',
  'team',
  'personal',
  'professional',
  'academic',
  'faculty',
  'web',
  'website',
  'websites',
  'site',
  'webpage',
  'page',
  'homepage',
  'home',
  'link',
  'url',
  'profile',
  'cv',
  'bio',
  'more',
  'info',
  'information',
  'here',
  'click',
  'visit',
  'view',
  'external',
  'portfolio',
]);
const MAX_LINK_LABEL_WORDS = 4;

const LINK_WRAPPER_PREFIX_RE =
  /^(?:links?\s+to|visit|go\s+to|see|view|check\s+out|more\s+(?:about|on))\s+(?:the\s+)?/i;
// A bare ">" is deliberately absent: it is far likelier to be the tail of
// literal markup ("Smith Lab <span ...>") that must stay rejectable than a link
// chevron, and stripping it would hide the markup from the HTML guard.
const LINK_WRAPPER_SUFFIX_RE =
  /\s*(?:[»›→]+|\((?:external\s+)?link\)|\(opens?\s+in\s+[^)]*\))\s*$/i;

/**
 * Removes the anchor-text wrapper a CMS puts around a link so the name it wraps
 * survives: "Link to Boggon Lab" is a label applied to a correct name, not a
 * name (#2285). Runs before classification and before the label check, so a
 * wrapper around nothing ("Link to Website") reduces to a bare label and is
 * rejected on its own merits rather than adopted with the chrome attached.
 */
export function stripResearchHomeNameLinkWrapper(value: unknown): string {
  const name = textValue(value);
  if (!name) return '';
  return name.replace(LINK_WRAPPER_SUFFIX_RE, '').replace(LINK_WRAPPER_PREFIX_RE, '').trim();
}

const NAME_WORD_RE = /[a-z0-9]+/g;

const PERSON_NAME_STOP_WORDS = new Set([
  'dr',
  'prof',
  'professor',
  'jr',
  'sr',
  'ii',
  'iii',
  'iv',
  'phd',
  'md',
  'mph',
  'msc',
  'mba',
  'dvm',
  'rn',
  'the',
  'van',
  'von',
  'de',
  'del',
  'della',
  'di',
  'da',
  'du',
  'la',
  'le',
]);

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

function nameWords(value: unknown): string[] {
  return (textValue(value).toLowerCase().match(NAME_WORD_RE) || []).filter(Boolean);
}

export function personIdentityTokens(personName: unknown): string[] {
  return nameWords(personName).filter(
    (word) => word.length >= 2 && !PERSON_NAME_STOP_WORDS.has(word),
  );
}

/**
 * A name whose head noun is an umbrella organization rather than a research
 * home. A name reading as a lab or group is not umbrella even when it also
 * carries an organizational word, so "Yale Rheumatology Clinical &
 * Translational Research Laboratory" stays a research home while "Yale Center
 * for Customer Insights" does not. "Working group" is the exception: it is a
 * standing committee shape, not a lab.
 */
export function isUmbrellaOrganizationName(value: unknown): boolean {
  const name = textValue(value);
  if (!name) return false;
  if (WORKING_GROUP_RE.test(name)) return true;
  if (RESEARCH_HOME_LAB_HEAD_RE.test(name)) return false;
  return UMBRELLA_ORGANIZATION_HEAD_RE.test(name);
}

/**
 * A content-management link label ("Lab Website", "Research Page") rather than
 * the linked site's name. It identifies nothing and must never be a name.
 */
export function isNonIdentifyingLinkLabelName(value: unknown): boolean {
  const words = nameWords(value);
  if (words.length === 0 || words.length > MAX_LINK_LABEL_WORDS) return false;
  return words.every((word) => LINK_LABEL_WORDS.has(word));
}

export function nameCarriesPersonIdentity(value: unknown, personName: unknown): boolean {
  const tokens = personIdentityTokens(personName);
  if (tokens.length === 0) return false;
  const words = new Set(nameWords(value));
  return tokens.some((token) => words.has(token));
}

// Path segments that structure a site rather than name a person, so they never
// corroborate an eponym.
const STRUCTURAL_URL_SEGMENT_WORDS = new Set([
  'lab',
  'labs',
  'laboratory',
  'laboratories',
  'group',
  'groups',
  'research',
  'people',
  'person',
  'profile',
  'faculty',
  'about',
  'home',
  'index',
  'main',
  'default',
  'www',
  'site',
  'web',
  'center',
  'centers',
  'centre',
  'centres',
  'institute',
  'program',
  'programs',
  'department',
  'dept',
  'yale',
  'edu',
  'org',
  'com',
  'net',
]);

// An eponymous lab name is a single surname (optionally preceded by a name
// particle) directly in front of the lab head noun: "The Liu Lab", "De Camilli
// Lab", "Kliman Laboratories". Requiring exactly one surname token keeps topical
// names out ("Computational Biomechanics Laboratory", "Yale NLP Lab"), which is
// what makes the rule safe to act on.
const EPONYMOUS_LAB_NAME_RE =
  /^(?:the\s+)?((?:de|van|von|del|della|di|da|du|la|le|el|al|st)\s+)?([a-z][a-z'’-]*)\s+(?:lab|labs|laborator(?:y|ies)|group)\b/i;

/** The surname an eponymous lab name claims ownership for, if it is one. */
export function eponymousLabNameSurname(harvestedName: unknown): string {
  const match = EPONYMOUS_LAB_NAME_RE.exec(textValue(harvestedName));
  const surname = (match?.[2] || '').toLowerCase();
  return surname.length >= 2 ? surname : '';
}

/**
 * Both spellings a nobiliary-particle surname can take: "De Camilli Lab" is
 * `camilli` in prose and `decamilli` in a URL path, so corroborating only the
 * bare surname silently fails on exactly the names most likely to be a
 * different person's lab (#2285).
 */
export function eponymousLabNameSurnameCandidates(harvestedName: unknown): string[] {
  const match = EPONYMOUS_LAB_NAME_RE.exec(textValue(harvestedName));
  const surname = (match?.[2] || '').toLowerCase();
  if (surname.length < 2) return [];
  const particle = (match?.[1] || '').trim().toLowerCase();
  return particle ? [surname, `${particle}${surname}`] : [surname];
}

/**
 * The surname an eponymous lab name claims, but only when the linked site's URL
 * path independently names that same person ("The Liu Lab" at `/lab/jun-liu/`).
 *
 * Requiring the corroboration keeps a topical name whose own host echoes it
 * ("Belief Lab" at `belieflab.yale.edu`) out of the rule, which is why only path
 * segments count and never the host.
 */
export function corroboratedLabNameEponyms(harvestedName: unknown, websiteUrl: unknown): string[] {
  const candidates = eponymousLabNameSurnameCandidates(harvestedName);
  if (candidates.length === 0) return [];
  const raw = textValue(websiteUrl);
  if (!raw) return [];
  let pathname: string;
  try {
    pathname = new URL(raw).pathname;
  } catch {
    return [];
  }
  const pathWords = new Set(
    (pathname.toLowerCase().match(NAME_WORD_RE) || []).filter(
      (word) => word.length >= 2 && !STRUCTURAL_URL_SEGMENT_WORDS.has(word) && !/\d/.test(word),
    ),
  );
  const corroborated = candidates.filter((candidate) => pathWords.has(candidate));
  return corroborated.length > 0 ? [corroborated[0]] : [];
}

// Tokens a research-entity slug carries from its originating source rather than
// from a person, so they never stand in for the entity's person identity.
const ENTITY_KEY_SOURCE_WORDS = new Set([
  'ysm',
  'yse',
  'ysph',
  'som',
  'fas',
  'seas',
  'bbs',
  'wti',
  'dept',
  'nih',
  'nsf',
  'orcid',
  'atoz',
  'index',
  'lab',
  'labs',
  'laboratory',
  'group',
  'pi',
  'faculty',
  'research',
  'area',
  'core',
  'cores',
  'profile',
  'yale',
]);

/** The person-name-like tokens a research-entity slug carries, if any. */
export function entityKeyPersonTokens(entityKey: unknown): string[] {
  return nameWords(textValue(entityKey).replace(/-/g, ' ')).filter(
    (word) => word.length >= 2 && !/\d/.test(word) && !ENTITY_KEY_SOURCE_WORDS.has(word),
  );
}

/**
 * Whether an eponym names one of the identity's own tokens. A compressed
 * initial-plus-surname form ("XLiu" for Xiaofeng Liu) is the same person, so a
 * suffix match counts; otherwise the surnames must be equal.
 */
export function eponymMatchesIdentity(eponym: string, identityTokens: string[]): boolean {
  return identityTokens.some(
    (token) =>
      token === eponym ||
      (token.length >= 3 && eponym.endsWith(token)) ||
      (eponym.length >= 3 && token.endsWith(eponym)),
  );
}

/** The surname each display name ends on, as the eponym corroboration vocabulary. */
export function personSurnamesFromDisplayNames(displayNames: Iterable<unknown>): Set<string> {
  const surnames = new Set<string>();
  for (const displayName of displayNames) {
    const words = nameWords(displayName).filter(
      (word) => word.length >= 3 && !PERSON_NAME_STOP_WORDS.has(word) && !/\d/.test(word),
    );
    const surname = words[words.length - 1];
    if (surname) surnames.add(surname);
  }
  return surnames;
}

/**
 * Whether a harvested lab name claims a person other than the one this entity
 * belongs to.
 *
 * Two independent corroborations, because a foreign lab is only refusable once
 * something outside the name confirms the eponym is a person at all. The linked
 * site's URL path is one ("The Liu Lab" at `/lab/jun-liu/`). A roster of known
 * surnames is the other, and it is what covers the common shape the path rule
 * cannot see: a trainee's PI's lab sits on its own eponymous host with a bare or
 * generic path (`girgentilab.org`, `scherzerlaboratory.org`), so the host carries
 * the only echo of the surname and the host is deliberately not corroboration
 * (#2361). A topical name is not a surname, so "Belief Lab" and "The UPLiFT Lab"
 * stay this person's own however their host reads.
 */
export function claimsAnotherPersonsLab(args: {
  harvestedName: unknown;
  websiteUrl: unknown;
  identityTokens: string[];
  knownPersonSurnames?: ReadonlySet<string>;
}): boolean {
  if (args.identityTokens.length === 0) return false;
  const pathCorroborated = corroboratedLabNameEponyms(args.harvestedName, args.websiteUrl);
  if (pathCorroborated.length > 0) {
    return !pathCorroborated.some((eponym) => eponymMatchesIdentity(eponym, args.identityTokens));
  }
  const knownSurnames = args.knownPersonSurnames;
  if (!knownSurnames || knownSurnames.size === 0) return false;
  const rosterCorroborated = eponymousLabNameSurnameCandidates(args.harvestedName).filter(
    (candidate) => knownSurnames.has(candidate),
  );
  if (rosterCorroborated.length === 0) return false;
  return !rosterCorroborated.some((eponym) => eponymMatchesIdentity(eponym, args.identityTokens));
}

export type HarvestedNameIdentityVerdict =
  | 'OWN_IDENTITY'
  | 'AFFILIATED_ORGANIZATION'
  | 'ANOTHER_PERSONS_LAB'
  | 'NON_IDENTIFYING_LABEL'
  | 'UNUSABLE';

/**
 * Classifies a name harvested from a website linked off a person's profile.
 * `OWN_IDENTITY` is returned when the name carries the person's own name, or
 * reads as a research home rather than an umbrella organization; those are the
 * only cases where the harvested name may become the entity's identity.
 *
 * `harvestedDescription` is the blurb the profile's own lab slot carries beside
 * the link. A slot that describes what it links as a center, collaborative, or
 * consortium is declaring an affiliation even when its name reads as a lab, and
 * that blurb is the only evidence distinguishing the two (#2361).
 *
 * `knownPersonSurnames` is the roster the eponym check corroborates against; see
 * `claimsAnotherPersonsLab`. Omitting it keeps the older path-only behavior.
 */
export function classifyHarvestedResearchHomeName(args: {
  harvestedName: unknown;
  personName: unknown;
  websiteUrl?: unknown;
  harvestedDescription?: unknown;
  knownPersonSurnames?: ReadonlySet<string>;
}): HarvestedNameIdentityVerdict {
  const name = stripResearchHomeNameLinkWrapper(args.harvestedName);
  if (name.length < 2) return 'UNUSABLE';
  if (isNonIdentifyingLinkLabelName(name)) return 'NON_IDENTIFYING_LABEL';
  if (nameCarriesPersonIdentity(name, args.personName)) return 'OWN_IDENTITY';
  if (isUmbrellaOrganizationName(name)) return 'AFFILIATED_ORGANIZATION';
  if (isUmbrellaOrganizationName(args.harvestedDescription)) return 'AFFILIATED_ORGANIZATION';
  const foreign = claimsAnotherPersonsLab({
    harvestedName: name,
    websiteUrl: args.websiteUrl,
    identityTokens: personIdentityTokens(args.personName),
    knownPersonSurnames: args.knownPersonSurnames,
  });
  return foreign ? 'ANOTHER_PERSONS_LAB' : 'OWN_IDENTITY';
}

const PERSON_SCOPED_ENTITY_TYPES = new Set([
  'LAB',
  'FACULTY_RESEARCH_AREA',
  'INDIVIDUAL_RESEARCH',
  'FACULTY_PROJECT',
]);

const PERSON_SCOPED_KINDS = new Set(['lab', 'individual', 'solo']);

/**
 * Whether an entity's identity is a person or a person's lab, so an umbrella
 * organization name can never be its own name. Organization-shaped entities
 * (centers, institutes, initiatives, core facilities) are excluded because an
 * organization name is exactly the right name for them.
 */
export function isPersonScopedResearchEntity(entity: {
  entityType?: unknown;
  kind?: unknown;
}): boolean {
  const entityType = textValue(entity.entityType).toUpperCase();
  if (entityType) return PERSON_SCOPED_ENTITY_TYPES.has(entityType);
  return PERSON_SCOPED_KINDS.has(textValue(entity.kind).toLowerCase());
}
