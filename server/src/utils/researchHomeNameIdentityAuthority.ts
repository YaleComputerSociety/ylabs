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

const UMBRELLA_ORGANIZATION_HEAD_SOURCE =
  // "Collaboratory" is spelled out alongside "collaborative" because it is a
  // distinct word rather than an inflection of it, and Yale uses it for centres
  // ("The Education Collaboratory at Yale"). The lab-head regex does not match
  // inside it: `\blaborator(y)\b` needs a word boundary that "Collaboratory" has no
  // room for, so adding it here does not shadow a real laboratory.
  '(?:cent(?:er|re)s?|institutes?|programs?|programmes?|collaboratives?|collaborator(?:y|ies)|clinics?|consorti(?:um|a)|units?|initiatives?|networks?|councils?|committees?|offices?|divisions?|departments?|sections?|schools?|colleges?|foundations?|societ(?:y|ies)|registr(?:y|ies)|alliances?|coalitions?|partnerships?|task\\s+forces?|hospitals?|cores?|facilit(?:y|ies)|observator(?:y|ies)|museums?|librar(?:y|ies)|health\\s+systems?)';

const UMBRELLA_ORGANIZATION_HEAD_RE = new RegExp(`\\b${UMBRELLA_ORGANIZATION_HEAD_SOURCE}\\b`, 'i');

const NAME_PARTICLE_SOURCE = '(?:de|van|von|del|della|di|da|du|la|le|el|al|st)';

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

// Matched against the WHOLE value before any word-splitting: `nameWords` splits
// on non-alphanumerics, so "n/a" becomes ['n','a'] and can never match
// LINK_LABEL_WORDS however many placeholder tokens are added to that set (#2367).
const PLACEHOLDER_ENTITY_NAME_RE =
  /^(?:n\s*[/.]?\s*a|none|null|nil|unknown|unnamed|untitled|undefined|tbd|to\s+be\s+determined|not\s+applicable|not\s+available|no\s+name|blank|empty|placeholder|test|x{3,})[.!]*$|^[-–—.?*\s]+$/i;

/**
 * A filler value a source emitted in place of a name. It identifies nothing, so
 * it must never be stored as one and must never reach a student, and unlike a
 * link label it cannot be detected word-wise.
 */
export function isPlaceholderEntityName(value: unknown): boolean {
  const name = textValue(value).trim();
  if (!name) return false;
  return PLACEHOLDER_ENTITY_NAME_RE.test(name);
}

function nameCarriesIdentityToken(value: unknown, identityTokens: string[]): boolean {
  if (identityTokens.length === 0) return false;
  const words = new Set(nameWords(value));
  return identityTokens.some((token) => words.has(token));
}

export function nameCarriesPersonIdentity(value: unknown, personName: unknown): boolean {
  return nameCarriesIdentityToken(value, personIdentityTokens(personName));
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
const EPONYMOUS_LAB_NAME_RE = new RegExp(
  `^(?:the\\s+)?(${NAME_PARTICLE_SOURCE}\\s+)?([a-z][a-z'’-]*)\\s+(?:lab|labs|laborator(?:y|ies)|group)\\b`,
  'i',
);

// The same eponym shape for an organization head noun: "Rooney Center for Metal
// Geochemistry". Anchoring the surname directly in front of the head noun is what
// separates a person's own endowed organization from a topical one that merely
// shares a word with the record's slug ("Yale Cancer Center" for
// `cancer-research-lab`), which slug tokens alone cannot tell apart.
const EPONYMOUS_ORGANIZATION_NAME_RE = new RegExp(
  `^(?:the\\s+)?(${NAME_PARTICLE_SOURCE}\\s+)?([a-z][a-z'’-]*)\\s+${UMBRELLA_ORGANIZATION_HEAD_SOURCE}\\b`,
  'i',
);

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
  return eponymSurnameCandidates(EPONYMOUS_LAB_NAME_RE.exec(textValue(harvestedName)));
}

function eponymSurnameCandidates(match: RegExpExecArray | null): string[] {
  const surname = (match?.[2] || '').toLowerCase();
  if (surname.length < 2) return [];
  const particle = (match?.[1] || '').trim().toLowerCase();
  return particle ? [surname, `${particle}${surname}`] : [surname];
}

/** The surname an eponymous organization name claims ownership for, if it is one. */
export function eponymousOrganizationNameSurnameCandidates(value: unknown): string[] {
  return eponymSurnameCandidates(EPONYMOUS_ORGANIZATION_NAME_RE.exec(textValue(value)));
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

/**
 * Whether a harvested lab name claims a person other than the one this entity
 * belongs to, corroborated by the linked site's URL path.
 */
export function claimsAnotherPersonsLab(args: {
  harvestedName: unknown;
  websiteUrl: unknown;
  identityTokens: string[];
}): boolean {
  if (args.identityTokens.length === 0) return false;
  const eponyms = corroboratedLabNameEponyms(args.harvestedName, args.websiteUrl);
  if (eponyms.length === 0) return false;
  return !eponyms.some((eponym) => eponymMatchesIdentity(eponym, args.identityTokens));
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
 */
export function classifyHarvestedResearchHomeName(args: {
  harvestedName: unknown;
  personName: unknown;
  websiteUrl?: unknown;
}): HarvestedNameIdentityVerdict {
  const name = stripResearchHomeNameLinkWrapper(args.harvestedName);
  if (name.length < 2) return 'UNUSABLE';
  if (isNonIdentifyingLinkLabelName(name)) return 'NON_IDENTIFYING_LABEL';
  if (nameCarriesPersonIdentity(name, args.personName)) return 'OWN_IDENTITY';
  if (isUmbrellaOrganizationName(name)) return 'AFFILIATED_ORGANIZATION';
  const foreign = claimsAnotherPersonsLab({
    harvestedName: name,
    websiteUrl: args.websiteUrl,
    identityTokens: personIdentityTokens(args.personName),
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

/**
 * Whether a name a person-scoped record currently carries names something other
 * than that record: an umbrella organization it merely belongs to, or a
 * different person's lab.
 *
 * This takes the record itself rather than a harvest context because the same
 * judgement has to hold for a value already sitting on the document, not only
 * for one arriving from a scrape. A graft survives its own retirement: rolling
 * back the observation leaves the document untouched, and no faculty-directory
 * source emits `displayName`, so nothing ever overwrites it (#2351).
 *
 * The record's own person identity comes from `personName` when a lead is known
 * and otherwise from the slug, which is the same slug-token fallback the
 * microsite extractor's attribution check uses. The two are not interchangeable
 * as proof of identity: a person name is made of person-name words, so any
 * overlap identifies the record, while a slug carries topical words a shared
 * organization name is just as likely to carry ("cancer" for
 * `cancer-research-lab` and for "Yale Cancer Center"). A slug token therefore
 * only clears an organization name when it stands in the eponym position, which
 * is the same narrow shape that makes the foreign-lab rule safe to act on.
 */
export function personScopedResearchEntityNameNamesSomethingElse(args: {
  candidateName: unknown;
  entityType?: unknown;
  kind?: unknown;
  slug?: unknown;
  personName?: unknown;
  websiteUrl?: unknown;
}): boolean {
  if (!isPersonScopedResearchEntity(args)) return false;
  const name = stripResearchHomeNameLinkWrapper(args.candidateName);
  if (name.length < 2) return false;
  const personTokens = personIdentityTokens(args.personName);
  const identityTokens = personTokens.length ? personTokens : entityKeyPersonTokens(args.slug);
  if (nameCarriesIdentityToken(name, personTokens)) return false;
  if (isUmbrellaOrganizationName(name)) {
    return !eponymousOrganizationNameSurnameCandidates(name).some((eponym) =>
      eponymMatchesIdentity(eponym, identityTokens),
    );
  }
  return claimsAnotherPersonsLab({
    harvestedName: name,
    websiteUrl: args.websiteUrl,
    identityTokens,
  });
}
