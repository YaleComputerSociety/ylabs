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
import { normalizeName } from '../scrapers/utils/scraperHelpers';
import { isExternalScholarlyPlatformName } from './externalScholarlyPlatforms';
import {
  isMultiTenantAcademicHostRootUrl,
  isMultiTenantAcademicHostTenantPageUrl,
  multiTenantAcademicHostLabelIsDistinctive,
  multiTenantAcademicHostNameMatch,
} from './researchHomeWebsiteUrl';

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

// Trailing chrome a CMS appends to the anchor text of an outbound link: "Patel Lab
// Website", "Crews Laboratory Homepage", "Chen Lab Page". Distinct from
// LINK_WRAPPER_SUFFIX_RE, which only removes symbols and parenthetical asides, and
// from LINK_WRAPPER_PREFIX_RE, which removes a leading verb ("Link to Boggon Lab").
// Same family as #2285, on the side it did not cover.
const LINK_CHROME_SUFFIX_RE = /\s*(?:home\s*page|web\s*site|web\s*page|site|page|home)\s*$/i;

const RESEARCH_HOME_HEAD_NOUN_FOR_CHROME_RE =
  /\b(?:labs?|laborator(?:y|ies)|cent(?:er|re)s?|institutes?|programs?|programmes?|initiatives?|groups?|projects?|collaboratives?|consorti(?:um|a)|networks?|clinics?|cores?|facilit(?:y|ies)|observator(?:y|ies)|studios?)\b/i;

/**
 * Drops trailing link chrome when the name underneath still identifies a research
 * home: "Patel Lab Website" is a correct name wearing a label.
 *
 * Leaves the value alone when the remainder identifies nothing, so
 * `isPersonPageLinkLabelName` can refuse the whole thing rather than this quietly
 * reducing "Zucker Homepage" to a bare surname and passing it off as a name.
 */
export function stripResearchHomeNameLinkChrome(value: unknown): string {
  const name = textValue(value);
  if (!name) return '';
  if (!LINK_CHROME_SUFFIX_RE.test(name)) return name;
  const remainder = name.replace(LINK_CHROME_SUFFIX_RE, '').trim();
  return RESEARCH_HOME_HEAD_NOUN_FOR_CHROME_RE.test(remainder) ? remainder : name;
}

/**
 * The anchor text of a link to a person's own page, not the name of a research
 * home: "Zucker Homepage", "Bewersdorf Homepage", "Warren Research Website".
 *
 * `isNonIdentifyingLinkLabelName` cannot catch these because it requires EVERY word
 * to be a generic navigation word, and a surname never is. Measured over the live
 * corpus, 29 rows carried a name ending in link chrome and 13 of them were
 * `student_ready`, so a student was reading a hyperlink's label as a lab's name.
 * 23 of the 29 have a real name underneath and are handled by
 * `stripResearchHomeNameLinkChrome`; these are the remainder, where nothing survives
 * the strip and the value must be refused outright.
 */
export function isPersonPageLinkLabelName(value: unknown): boolean {
  const name = textValue(value);
  if (!name) return false;
  if (!LINK_CHROME_SUFFIX_RE.test(name)) return false;
  const remainder = name.replace(LINK_CHROME_SUFFIX_RE, '').trim();
  if (!remainder) return true;
  return !RESEARCH_HOME_HEAD_NOUN_FOR_CHROME_RE.test(remainder);
}

// The furniture a page hangs off a brand ("Google Scholar Profile", "ORCID
// Citations") and the head noun `personScopedResearchEntityNameFromPersonName`
// appends ("Google Scholar Lab"). Peeled from the END only, and only while every
// word peeled is furniture, so a real name that merely contains a platform brand
// ("Onofrey Lab GitHub", "Google Scholar Prize Lecture Series") keeps every word it
// has and the brand match below still has to account for the whole remainder.
const RESEARCH_HOME_NAME_FURNITURE_WORDS = new Set([
  ...LINK_LABEL_WORDS,
  'groups',
  'profiles',
  'citations',
  'publications',
]);

function withoutTrailingResearchHomeNameFurniture(name: string): string {
  const words = name.split(/\s+/);
  let end = words.length;
  while (
    end > 0 &&
    RESEARCH_HOME_NAME_FURNITURE_WORDS.has(words[end - 1].toLowerCase().replace(/[^a-z0-9]/g, ''))
  ) {
    end -= 1;
  }
  return words.slice(0, end).join(' ');
}

/**
 * The anchor text of a link to an external scholarly platform, whether it stands
 * bare ("Google Scholar"), wears a research-home head noun ("Google Scholar Lab",
 * "ORCID Faculty Research"), or wears the page furniture a profile's links section
 * hangs off it ("Google Scholar Profile"). None of them names a research home.
 *
 * The suffixed form is not something a page emits: it is manufactured downstream.
 * `isBarePersonNameEntityName` read "Google Scholar" as a person's name - two
 * capitalised words, no head noun, no compound punctuation - so the placeholder
 * derivation appended the convention's suffix and turned the label into a lab. The
 * result evades every guard that catches the bare brand, because
 * `isExternalScholarlyPlatformName` matches the whole value by design and the value
 * is no longer the whole brand. Measured on Development: 2 live person-keyed rows
 * were typed `LAB` and named "Google Scholar Lab", one of them `student_ready`,
 * while their only name observations asserted the bare brand (#2285).
 */
export function isExternalScholarlyPlatformLinkLabelName(value: unknown): boolean {
  const name = textValue(value);
  if (!name) return false;
  if (isExternalScholarlyPlatformName(name)) return true;
  const withoutFurniture = withoutTrailingResearchHomeNameFurniture(name);
  return withoutFurniture !== name && isExternalScholarlyPlatformName(withoutFurniture);
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
 * Whether a name declares an organization a student could join, of any shape, as
 * against a topic a professor works on. This is the union of the two head-noun
 * vocabularies above rather than a third one, so "Peccia Lab", "A. Douglas Stone
 * Research Group" and "Yale Center for Customer Insights" all read organizational
 * while "Anne Fadiman Faculty Research" does not.
 *
 * Deliberately blind to the lab-versus-umbrella line `isUmbrellaOrganizationName`
 * draws. That line decides whether a person-scoped row may take a name as its own
 * identity; this one decides whether a name is organizational at all, which is the
 * `LAB` versus `FACULTY_RESEARCH_AREA` axis, and a name can be organizational
 * without being a name the row may keep.
 */
export function namesAnOrganizationalResearchHome(value: unknown): boolean {
  const name = textValue(value);
  if (!name) return false;
  return RESEARCH_HOME_LAB_HEAD_RE.test(name) || UMBRELLA_ORGANIZATION_HEAD_RE.test(name);
}

/**
 * How a row's `entityType` contradicts the shape of its own name, or `''` when the
 * two agree.
 *
 * The typing rule the 2026-09-21 decision in `docs/decisions.md` establishes is
 * organizational identity versus topical scope, and name shape is the only measured
 * boundary that expresses it: across served Development rows, 1,020 of 1,062 `LAB`
 * names carry an organizational token against 1 of 2,148 `FACULTY_RESEARCH_AREA`
 * names. `websiteUrl` presence is a gradient at 72 against 23 percent and roster
 * size does not discriminate at all, so neither may key this rule.
 *
 * A verdict is a contradiction to report, never a demotion. Per the same decision a
 * `FACULTY_RESEARCH_AREA` backed only by the professor's profile is fully served, so
 * this predicate has no caller in the visibility gate and must not acquire one: a
 * contradicting row may be mis-typed OR mis-named, and which of the two it is cannot
 * be decided from the name that is already in doubt (#2884).
 */
export type ResearchEntityTypeNameContradiction =
  | 'lab_named_as_a_topic'
  | 'faculty_research_area_named_as_an_organization'
  | '';

export function researchEntityTypeNameContradiction(entity: {
  entityType?: unknown;
  name?: unknown;
  displayName?: unknown;
}): ResearchEntityTypeNameContradiction {
  const entityType = textValue(entity.entityType).toUpperCase();
  const name = textValue(entity.name) || textValue(entity.displayName);
  if (!name) return '';
  if (entityType === 'LAB') {
    return namesAnOrganizationalResearchHome(name) ? '' : 'lab_named_as_a_topic';
  }
  if (entityType === 'FACULTY_RESEARCH_AREA') {
    return namesAnOrganizationalResearchHome(name)
      ? 'faculty_research_area_named_as_an_organization'
      : '';
  }
  return '';
}

/**
 * Whether a harvested name is a site declaring itself a laboratory or research
 * group, and so may decide the record's `entityType` and not only its `name`.
 *
 * The boundary is the umbrella-organization rule rather than a second copy of it,
 * so a name that may not become a person-scoped record's identity can never
 * become its type either (#2234). A link label ("Lab Website") and a filler value
 * are excluded for the same reason they are excluded from names: they carry the
 * head noun without identifying anything.
 */
export function namesASelfDeclaredLaboratory(value: unknown): boolean {
  const name = textValue(value);
  if (!name) return false;
  if (!RESEARCH_HOME_LAB_HEAD_RE.test(name)) return false;
  if (isUmbrellaOrganizationName(name)) return false;
  if (namesAServiceFacility(name)) return false;
  if (isNonIdentifyingLinkLabelName(name)) return false;
  if (isPersonPageLinkLabelName(name)) return false;
  return !isPlaceholderEntityName(name);
}

/**
 * A diagnostic, specimen or shared-instrumentation service rather than a research
 * home a student could join. `isUmbrellaOrganizationName` cannot draw this line:
 * it returns false for anything lab-headed by design, so "Yale Pathology Labs"
 * and "Hematology Tissue Bank" read to it as research homes.
 *
 * Only SERVICE nouns decide. A modality is a research topic and must never decide,
 * because "Developmental Electrophysiology Laboratory" and "Chemical & Biomedical
 * Imaging Lab" are real research labs named after what they study. Measured over
 * 1,568 live `LAB` rows and 57 live `CORE_FACILITY` rows: this flags 17 `LAB` rows
 * (1.1%), of which 16 are genuinely mis-typed services (an autopsy service, an
 * apheresis/transfusion service, a specimen biobank, a tissue bank, clinical
 * virology, molecular diagnostics, pathology labs, an echo core, a proteomics
 * resource), and reaches 47% of the core facilities. The single genuine miss is a
 * research lab whose name carries the word "Diagnostic".
 *
 * Recall is deliberately partial. A clinical service lab named only for its field
 * ("Immunology Laboratory", "Reproductive Endocrinology Laboratory") is
 * indistinguishable BY NAME from a research lab named for its field, so separating
 * those needs the sentence that introduces it, not this predicate. Callers must
 * treat a pass here as "not obviously a service" rather than as proof of a lab.
 */
const SERVICE_FACILITY_NOUN_RE =
  /\b(?:cores?|resources?|services?|bank|biobank|biorepositor(?:y|ies)|repositor(?:y|ies)|diagnostics?|cytolog\w*|histolog\w*|phlebotom\w*|autops\w*|morgue|specimens?|tumor\s+profiling|genotyping\s+service|clinical\s+(?:chemistry|virolog\w*|serolog\w*|microbiolog\w*|patholog\w*)|patholog\w*\s+labs?|blood\s+bank|tissue\s+bank|dialysis|infusion|catheteri\w*|pulmonary\s+function|reference\s+laborator\w*|testing\s+laborator\w*)\b/i;

export function namesAServiceFacility(value: unknown): boolean {
  const name = textValue(value);
  if (!name) return false;
  return SERVICE_FACILITY_NOUN_RE.test(name);
}

// A blurb is prose, so an organizational word inside it can merely MENTION an
// organization ("Research in the Department of Psychiatry on adolescent sleep")
// instead of declaring what the slot links. Requiring the head noun to be the
// phrase the blurb ENDS on separates the two, so describing where a lab sits
// never costs the lab its own name, type, and website (#2361).
const TRAILING_UMBRELLA_ORGANIZATION_RE = new RegExp(
  `\\b${UMBRELLA_ORGANIZATION_HEAD_SOURCE}[\\s.,;:!?)]*$`,
  'i',
);

// Trailing position alone is not enough: an ordinary mention can also fall at the
// end ("Clinical research at Northgate Children's Hospital"), and a locative
// lead-in is what marks the organization as WHERE the lab sits rather than WHAT the
// slot links. Requiring no clause break between the two keeps the organization the
// object of that preposition. Where the two shapes genuinely overlap ("A
// collaborative of investigators at Northgate School of Medicine") this declines to
// refuse, because the mention shape is the one that costs a real lab its name, type,
// and website (#2361).
const ORGANIZATION_MENTIONED_AS_LOCATION_RE = new RegExp(
  '\\b(?:at|in|within|inside|across|throughout|near|by|with|under|through|part\\s+of|' +
    'affiliated\\s+with|based\\s+(?:at|in)|housed\\s+(?:at|in|within)|hosted\\s+(?:at|by))\\b' +
    `[^,;:]*\\b${UMBRELLA_ORGANIZATION_HEAD_SOURCE}[\\s.,;:!?)]*$`,
  'i',
);

/**
 * Whether a free-text blurb beside a linked site NAMES an umbrella organization
 * as the thing it links, rather than mentioning one in passing. This is the
 * description-shaped counterpart of `isUmbrellaOrganizationName`, which reads a
 * name and would over-refuse on prose.
 */
export function describesAffiliatedOrganization(value: unknown): boolean {
  const description = textValue(value);
  if (!description) return false;
  if (RESEARCH_HOME_LAB_HEAD_RE.test(description)) return false;
  if (ORGANIZATION_MENTIONED_AS_LOCATION_RE.test(description)) return false;
  return TRAILING_UMBRELLA_ORGANIZATION_RE.test(description);
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

const RESEARCH_ENTITY_NAME_HEAD_NOUN_RE = new RegExp(
  `${RESEARCH_HOME_LAB_HEAD_RE.source}|${UMBRELLA_ORGANIZATION_HEAD_RE.source}|` +
    '\\b(?:research|studies|study|studios?|projects?|teams?|workshops?|seminars?|archives?|collections?)\\b',
  'i',
);

const PERSON_NAME_PARTICLES = new Set([
  'de',
  'del',
  'della',
  'der',
  'den',
  'di',
  'da',
  'das',
  'dos',
  'du',
  'el',
  'la',
  'le',
  'ter',
  'van',
  'von',
  'y',
]);

const PERSON_NAME_GENERATIONAL_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

const PERSON_NAME_WORD_RE = /^\p{Lu}[\p{L}'’]*(?:[-'’]\p{Lu}?[\p{L}'’]*)*\.?$/u;

const PERSON_NAME_INITIAL_RE = /^\p{Lu}\.?$/u;

// A compound label announces itself with punctuation a person's name never
// carries: an ampersand, a slash, a colon, a parenthesised acronym. Only a
// parenthesised nickname and a single inverted-order comma survive.
const COMPOUND_LABEL_PUNCTUATION_RE = /[&/:;+|]|--|\d/;

const MIN_PERSON_NAME_WORDS = 2;
const MAX_PERSON_NAME_TOKENS = 4;

function personNameOrderedTokens(value: string): string[] | null {
  const commaParts = value.split(',');
  if (commaParts.length > 2) return null;
  const ordered =
    commaParts.length === 2 ? `${commaParts[1].trim()} ${commaParts[0].trim()}` : commaParts[0];
  return ordered
    .trim()
    .replace(/^(?:the|a|an)\s+/i, '')
    .replace(/\((?:[^()]*)\)/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Whether a name is nothing but a person's own name, in any ordering the corpus
 * stores it: natural order, inverted "Surname, Given", with a name particle, an
 * initial, a generational suffix, or a parenthesised nickname.
 *
 * The product retired the person page (#1938), so a person-scoped record titled
 * with a bare person name promises a person surface that does not exist, where
 * "<Person> Faculty Research" and "<Person> Lab" read as the research record they
 * are. That is exactly what `dept-faculty-roster`, `ysm-faculty-directory` and
 * `yse-faculty-directory` already build, so this predicate selects the rows that
 * missed the convention rather than inventing one.
 *
 * Deliberately narrower than "carries no research word", which is not a usable
 * separator: measured over the served Development corpus, 35 of the 96
 * person-scoped rows whose name has no research or organizational word are
 * legitimate brands - a coined single token, an all-caps or mixed-case acronym, an
 * expansion carrying its own acronym in parentheses - which is the same class
 * #2360 found a blanket demotion regresses. A single token, a digit, a lower-case
 * function word and compound-label punctuation each keep such a name out, and each
 * of those is what distinguishes a topical or programme title from a person.
 */
export function isBarePersonNameEntityName(value: unknown): boolean {
  const name = textValue(value);
  if (!name) return false;
  if (RESEARCH_ENTITY_NAME_HEAD_NOUN_RE.test(name)) return false;
  // The derivation below runs AFTER the name authority's refusals and on the value a
  // refusal left behind, and it turns whatever this accepts into a research home, so
  // every class the authority refuses has to be excluded here or the derivation
  // launders it past the vocabulary that refused it: "Google Scholar" became "Google
  // Scholar Lab", and "Not Available" and "Zucker Homepage" would become labs, each
  // wearing a head noun their own refusing predicate can no longer see (#2285).
  if (
    isExternalScholarlyPlatformLinkLabelName(name) ||
    isPlaceholderEntityName(name) ||
    isNonIdentifyingLinkLabelName(name) ||
    isPersonPageLinkLabelName(name)
  ) {
    return false;
  }
  if (COMPOUND_LABEL_PUNCTUATION_RE.test(name)) return false;
  const tokens = personNameOrderedTokens(name);
  if (!tokens) return false;
  if (tokens.length < MIN_PERSON_NAME_WORDS || tokens.length > MAX_PERSON_NAME_TOKENS) return false;
  let words = 0;
  for (const [index, token] of tokens.entries()) {
    const lowered = token.toLowerCase().replace(/\.$/, '');
    // A particle only ever PRECEDES the surname it belongs to ("van Gogh", "de
    // Silva"), so a trailing one is the surname itself rather than a particle.
    // Discounting it there refused every person whose surname happens to be a
    // particle word - Le, Du, Das, Van, De, Da - because one counted word cannot
    // reach the two-word floor, and the corrected name those callers derive came
    // back empty, leaving a fabricated lab name in place (#3145).
    // `piNameMatch.stripLeadingParticles` already stops at `length - 1` for this
    // reason; the two must keep agreeing.
    const isTrailingToken = index === tokens.length - 1;
    if (
      (!isTrailingToken && PERSON_NAME_PARTICLES.has(lowered)) ||
      PERSON_NAME_GENERATIONAL_SUFFIXES.has(lowered)
    ) {
      continue;
    }
    if (PERSON_NAME_INITIAL_RE.test(token)) continue;
    if (!PERSON_NAME_WORD_RE.test(token)) return false;
    words += 1;
  }
  return words >= MIN_PERSON_NAME_WORDS;
}

const LAB_SCOPED_ENTITY_TYPES = new Set(['LAB']);
const LAB_SCOPED_KINDS = new Set(['lab']);

// The two suffixes the roster scrapers already write, so the corpus keeps one
// naming convention rather than gaining a second. This is a name suffix and not a
// kind label: `entityKindLabel` stays the only owner of the pill a student reads.
const LAB_RESEARCH_ENTITY_NAME_SUFFIX = 'Lab';
const FACULTY_RESEARCH_ENTITY_NAME_SUFFIX = 'Faculty Research';

function researchEntityNameSuffix(entity: { entityType?: unknown; kind?: unknown }): string {
  const entityType = textValue(entity.entityType).toUpperCase();
  if (entityType) {
    return LAB_SCOPED_ENTITY_TYPES.has(entityType)
      ? LAB_RESEARCH_ENTITY_NAME_SUFFIX
      : FACULTY_RESEARCH_ENTITY_NAME_SUFFIX;
  }
  return LAB_SCOPED_KINDS.has(textValue(entity.kind).toLowerCase())
    ? LAB_RESEARCH_ENTITY_NAME_SUFFIX
    : FACULTY_RESEARCH_ENTITY_NAME_SUFFIX;
}

/**
 * The research-record name a person-scoped row's bare person name should carry,
 * or `''` when the row is not person-scoped or its name already names a research
 * record.
 *
 * A substitution rather than a withhold, because `name` is the heading fallback
 * every serve path lands on once `displayName` is refused: clearing it would serve
 * a blank heading, and holding the row at `operator_review` would remove a record
 * whose correct name is recoverable from the value already on it. Idempotent, since
 * the derived value carries a head noun and so is no longer a bare person name.
 */
export function personScopedResearchEntityNameFromPersonName(entity: {
  candidateName: unknown;
  entityType?: unknown;
  kind?: unknown;
}): string {
  if (!isPersonScopedResearchEntity(entity)) return '';
  const name = textValue(entity.candidateName);
  if (!isBarePersonNameEntityName(name)) return '';
  const tokens = personNameOrderedTokens(name);
  if (!tokens) return '';
  return `${tokens.join(' ')} ${researchEntityNameSuffix(entity)}`;
}

const FACULTY_RESEARCH_NAME_SUFFIX_RE = /\s+faculty\s+research$/i;

/**
 * The name a row typed `LAB` should carry when it still wears the person-scoped
 * suffix, or `''` when the row is not in that state.
 *
 * `personScopedResearchEntityNameFromPersonName` derives the suffix once, from the
 * type as it stood on that pass, and then protects itself from re-running by
 * refusing anything carrying a head noun. That self-protection is what leaves the
 * suffix stale after a later retype: the row asserts `LAB` in `entityType`, derives
 * `kind: 'lab'` from it, serves the lab kind label a student reads, and heads the
 * page "<person> Faculty Research". #3193 decided the three travel together at emit
 * time; nothing re-decided them when the type moved.
 *
 * One direction only, and the asymmetry is measured rather than cautious. The
 * "Faculty Research" suffix is manufactured here and by the roster lanes, so it
 * carries no harvested information and re-deriving it destroys nothing. The
 * opposite direction reads the same shape but not the same evidence: of 34 live
 * Development rows typed `FACULTY_RESEARCH_AREA` whose name is a bare person name
 * plus "Lab", 29 have that exact name asserted by a source that read a page, so the
 * name is evidence for a laboratory and the type is the field in doubt. Which of
 * the two is wrong cannot be decided from the name (#2884), and the type side has
 * page-reading owners already: `research-entity:backfill-lab-branded-name-type` and
 * `research-entity:promote-faculty-research`.
 */
export function labResearchEntityNameFromStaleFacultyResearchSuffix(entity: {
  candidateName: unknown;
  entityType?: unknown;
  kind?: unknown;
}): string {
  if (textValue(entity.entityType).toUpperCase() !== 'LAB') return '';
  const name = textValue(entity.candidateName);
  if (!FACULTY_RESEARCH_NAME_SUFFIX_RE.test(name)) return '';
  const derived = personScopedResearchEntityNameFromPersonName({
    ...entity,
    candidateName: name.replace(FACULTY_RESEARCH_NAME_SUFFIX_RE, '').trim(),
  });
  return derived === name ? '' : derived;
}

/**
 * The research-record name to substitute when the name a person-scoped row carries
 * names something else and no candidate observation offers one that does not.
 *
 * `name` is the heading every serve path falls back to once `displayName` is
 * refused, so it may not be cleared, which is why the refusal previously left a
 * different person's lab name on the row indefinitely: nothing could replace it and
 * nothing was allowed to remove it (#2369). The record's own lead is the one
 * replacement that needs no new evidence, and it reads as the research record it is
 * on the same terms as `personScopedResearchEntityNameFromPersonName`'s
 * substitution. Idempotent, because the derived value carries a head noun.
 *
 * The shape gate reads the KEY as well as the type, the same pair
 * `personScopedNameIdentityPrelude` opens on. A graft that asserts an organization's
 * `entityType` alongside its name would otherwise leave this substitution empty for
 * exactly the rows the refusal caught, and an empty substitution on the heading field
 * is a blank heading: 6 served Development rows whose name the refusal condemns had no
 * substitute available for that reason (#2913, #3132).
 *
 * `currentName` is the value being replaced, and the substitution declines when that
 * value carries the record's OWN key token. The refusal upstream only ever compares a
 * name against PERSON identity, so it cannot tell a graft from a record whose name is
 * genuinely its own: `ysm-neuropet` is typed LAB, is named for a programme, and cites
 * `medicine.yale.edu/lab/neuropet/`, so the type arm opened and the name read as naming
 * something else. That refusal was wrong before this substitution existed and merely
 * inert; wiring the substitution into the serve path made it overwrite a source-backed
 * name with its director's (#3132). A name sharing a token with the key is the record's
 * own designation, and it is the one piece of self-evidence available with no lead.
 */
export function personScopedResearchEntityNameFromLeadPersonName(entity: {
  leadPersonName: unknown;
  entityType?: unknown;
  kind?: unknown;
  slug?: unknown;
  personName?: unknown;
  currentName?: unknown;
}): string {
  if (!isPersonScopedResearchEntity(entity) && !entityKeyNamesOnlyThisPerson(entity)) return '';
  if (nameCarriesIdentityToken(entity.currentName, entityKeyPersonTokens(entity.slug))) return '';
  const leadPersonName = normalizeName(textValue(entity.leadPersonName));
  if (!isBarePersonNameEntityName(leadPersonName)) return '';
  const tokens = personNameOrderedTokens(leadPersonName);
  if (!tokens) return '';
  return `${tokens.join(' ')} ${researchEntityNameSuffix(entity)}`;
}

// A named professorship ("<Benefactor> Professor of <Field>"). Mirrors
// `isBareChairTitleFragment`, which refuses the same shape as a DESCRIPTION; this
// is the name-shaped half, and the two are deliberately separate predicates
// because a name is not prose and needs no sentence anchoring.
const ACADEMIC_APPOINTMENT_NAME_RE =
  /^(?:[\p{L}][\p{L}.'’-]*(?:[\s-][\p{L}.'’-]+){0,6}\s+)?(?:Professor|Professorship|Lecturer|Dean|Provost|Chair|Fellow)\b(?:\s+(?:of|in|for|emerit\w+)\b[\p{L},&'’ -]{0,120})?\.?$/u;

// A bare host name. A site's domain is where a thing is
// published rather than what it is called, so it can never title a research record.
const BARE_HOST_NAME_RE =
  /^(?:https?:\/\/)?(?:www\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)*\.(?:org|com|net|edu|gov|io|info|co)\/?$/i;

/**
 * Whether a person-scoped row's name names something the product does not serve
 * and from which no research-record name can be derived: a named professorship, or
 * a bare host name.
 *
 * Distinct from `isBarePersonNameEntityName`, which is recoverable. There is
 * nothing to substitute here, so the answer is the `unusable_name` gate blocker
 * rather than a serve-time withhold: a blank heading is worse than a held row, and
 * the way to publish such a row is to give it a real name.
 */
export function isUnrecoverablePersonScopedEntityName(value: unknown): boolean {
  const name = textValue(value);
  if (!name) return false;
  if (RESEARCH_HOME_LAB_HEAD_RE.test(name)) return false;
  if (BARE_HOST_NAME_RE.test(name)) return true;
  return ACADEMIC_APPOINTMENT_NAME_RE.test(name);
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

// A possessive names its holder, so the token carrying it is a person by grammar
// rather than by position. That is the one shape where the surname need not be
// anchored at the start: "Christopher G Bunick' lab" and "Nik Joshi's laboratory"
// both state whose lab it is, and the anchored single-token rule above sees
// neither. The head noun still has to follow immediately, which is what keeps this
// off ordinary prose.
const POSSESSIVE_LAB_NAME_OWNER_RE =
  /([a-z][a-z'’-]*?)['’]s?\s+(?:lab|labs|laborator(?:y|ies)|group)\b/i;

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
  const name = textValue(harvestedName);
  const anchored = eponymSurnameCandidates(EPONYMOUS_LAB_NAME_RE.exec(name));
  if (anchored.length > 0) return anchored;
  const possessiveOwner = withoutPossessiveSuffix(
    (POSSESSIVE_LAB_NAME_OWNER_RE.exec(name)?.[1] || '').toLowerCase(),
  );
  return possessiveOwner.length >= 2 ? [possessiveOwner] : [];
}

/**
 * A trailing possessive is grammar, not part of the surname, and the eponym
 * character class deliberately admits an interior apostrophe so `O'Hern` survives
 * as one token. Leaving the possessive attached spelled the eponym `herzog's`,
 * which corroborated against neither the URL path word nor a roster surname, so
 * `claimsAnotherPersonsLab` read a different person's lab as the record's own
 * identity (#2361).
 */
function withoutPossessiveSuffix(surname: string): string {
  return surname.replace(/['’]s?$/, '');
}

function eponymSurnameCandidates(match: RegExpExecArray | null): string[] {
  const surname = withoutPossessiveSuffix((match?.[2] || '').toLowerCase());
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

// A slug can glue the research-home head noun straight onto the surname with no
// separator (`ysm-leveylab`), which leaves `entityKeyPersonTokens` nothing to split
// on and hides the surname from the eponym check.
const GLUED_RESEARCH_HOME_HEAD_RE = /(?:labs?|laborator(?:y|ies)|groups?)$/;

function identityTokenSpellings(token: string): string[] {
  const withoutResearchHomeHead = token.replace(GLUED_RESEARCH_HOME_HEAD_RE, '');
  return withoutResearchHomeHead !== token && withoutResearchHomeHead.length >= 2
    ? [token, withoutResearchHomeHead]
    : [token];
}

/**
 * Whether an eponym names one of the identity's own tokens. A compressed
 * initial-plus-surname form ("XLiu" for Xiaofeng Liu) is the same person, so a
 * suffix match counts; otherwise the surnames must be equal.
 *
 * A token that glues the research-home head noun onto the surname is the same
 * person too: an identity resolved from the slug `ysm-leveylab` IS Levey. Without
 * that spelling the roster arm reads "Levey Lab" as somebody else's lab and the
 * repair renames a record whose name was right (#2368).
 */
export function eponymMatchesIdentity(eponym: string, identityTokens: string[]): boolean {
  return identityTokens
    .flatMap(identityTokenSpellings)
    .some(
      (token) =>
        token === eponym ||
        (token.length >= 3 && eponym.endsWith(token)) ||
        (eponym.length >= 3 && token.endsWith(eponym)),
    );
}

/**
 * Whether a record's key names the person it belongs to and nothing else, which
 * makes it that person's record whatever `entityType` a harvest wrote on it.
 *
 * `isPersonScopedResearchEntity` reads `entityType`, so a graft that asserts an
 * organization's name and an organization's type in the same batch disables every
 * person-scoped name guard with the very assertion that put the name there
 * (#2913). A key is the one identity signal a harvest cannot rewrite, so it is
 * what the judgement falls back to.
 *
 * EVERY key token has to be accounted for by the lead's own name rather than the
 * surname alone: a surname-only rule would open a genuine
 * `<benefactor>-institute-for-<field>` key whenever its director happens to share
 * the benefactor's surname, and an organization's own name is exactly the right
 * name for an organization. `eponymMatchesIdentity` supplies the compressed and
 * glued spellings a key uses for a person (`ysm-faculty-redelson` for R. Edelson).
 * Measured over the live Development corpus this opens 27 organization-typed rows,
 * every one of them a person-keyed shell, and leaves organization-keyed rows shut.
 */
export function entityKeyNamesOnlyThisPerson(args: {
  slug?: unknown;
  personName?: unknown;
}): boolean {
  const personTokens = personIdentityTokens(args.personName);
  if (personTokens.length < 2) return false;
  const keyTokens = entityKeyPersonTokens(args.slug);
  if (keyTokens.length === 0) return false;
  const surname = personTokens[personTokens.length - 1];
  if (!keyTokens.some((token) => eponymMatchesIdentity(token, [surname]))) return false;
  return keyTokens.every((token) => eponymMatchesIdentity(token, personTokens));
}

/**
 * The surname each display name ends on, as the eponym corroboration vocabulary.
 *
 * `normalizeName` runs first because it is the repo's owner for peeling a
 * credential clause off a display name, and a roster built on a divergent rule
 * records the credential AS the surname: "Avery Sloan, MS" would contribute 'ms'
 * and never 'sloan', so an eponym-shaped topical name ("MS Lab") gets refused
 * while a genuinely foreign "Sloan Lab" stays adoptable.
 *
 * Two-letter tokens count, on the same threshold `personIdentityTokens` uses:
 * "Wu" and "Xu" are surnames the eponym rule already accepts, so dropping them
 * would both leave "Wu Lab" unrefusable and record the GIVEN name of "Sheng Wu"
 * as a surname. Single-letter initials and comma-less credential tails are what
 * the token filter is for.
 */
export function personSurnamesFromDisplayNames(displayNames: Iterable<unknown>): Set<string> {
  const surnames = new Set<string>();
  for (const displayName of displayNames) {
    const words = nameWords(normalizeName(textValue(displayName))).filter(
      (word) => word.length >= 2 && !PERSON_NAME_STOP_WORDS.has(word) && !/\d/.test(word),
    );
    const surname = words[words.length - 1];
    if (surname) surnames.add(surname);
  }
  return surnames;
}

/**
 * Every token that names the person a research home belongs to: the resolved
 * lead's own name AND the record's own key, unioned rather than one preferred over
 * the other.
 *
 * Preferring the lead name and falling back to the key only when no lead resolves
 * is what makes the roster arm unsafe at a write chokepoint, and both directions
 * were measured on the live Development corpus. A key can spell the surname glued
 * to nothing the word splitter can see (`ysm-kexu` for Ke Xu) or carry only the
 * given names of a person whose surname the directory records differently, so
 * key-only identity refused two records' OWN eponymous labs. A lead record can
 * hold a single given name, so lead-only identity refused a record whose key
 * spelled the surname correctly. Each source covers what the other misses, and
 * neither can be grafted into naming the wrong person by the harvest whose name
 * this predicate is judging (#2913).
 */
export function researchHomeIdentityTokens(args: {
  personName?: unknown;
  slug?: unknown;
}): string[] {
  return Array.from(
    new Set([...personIdentityTokens(args.personName), ...entityKeyPersonTokens(args.slug)]),
  );
}

/**
 * Which evidence an eponym check is actually about to be judged against.
 *
 * `resolved_lead` is the real predicate. `entity_key_tokens` is a strictly weaker
 * approximation, because a slug names the research rather than the person
 * (`yale-sleep-neurobiology-lab`) and a glued key hides a surname outright
 * (`ysm-leveylab`). `none` is not a weaker signal but the absence of one: with no
 * identity tokens at all, `eponymMatchesIdentity` cannot match anything, so every
 * eponym reads as somebody else's and a correctly self-named record is refused on
 * no evidence.
 *
 * Named so a caller can report which one it used. The fallback itself is not the
 * defect; the defect was that it was silent, so a degraded verdict and a
 * fully-evidenced one were indistinguishable in a report (#2384).
 */
export type ResearchHomeIdentitySource = 'resolved_lead' | 'entity_key_tokens' | 'none';

export function researchHomeIdentitySource(args: {
  personName?: unknown;
  slug?: unknown;
}): ResearchHomeIdentitySource {
  if (personIdentityTokens(args.personName).length > 0) return 'resolved_lead';
  return entityKeyPersonTokens(args.slug).length > 0 ? 'entity_key_tokens' : 'none';
}

/**
 * An explicitly empty surname roster, for a call site that cannot reach one - a
 * synchronous per-request or pure decision path. Passing this is a declaration that
 * the eponym check runs path-only here, greppable and reviewable, as opposed to an
 * inline `new Set()` that reads like an oversight or an omitted optional argument
 * that reads like nothing at all (#2368).
 *
 * The write chokepoints no longer use it: the materializer's name authority and the
 * microsite extractor's page attribution both corroborate against a real roster
 * (#2369). What is left is the read paths, which stay path-only deliberately -
 * they are a backstop over already-guarded data, and the DTO path is synchronous
 * and per-request so it cannot reach a corpus roster at all.
 */
export const NO_SURNAME_ROSTER: ReadonlySet<string> = new Set();

/**
 * The path-only half of `claimsAnotherPersonsLab`, for a caller with no roster to
 * corroborate against. The weaker of the two and says so in its name.
 */
export function claimsAnotherPersonsLabByUrlPath(args: {
  harvestedName: unknown;
  websiteUrl: unknown;
  identityTokens: string[];
}): boolean {
  if (args.identityTokens.length === 0) return false;
  const pathCorroborated = corroboratedLabNameEponyms(args.harvestedName, args.websiteUrl);
  if (pathCorroborated.length === 0) return false;
  return !pathCorroborated.some((eponym) => eponymMatchesIdentity(eponym, args.identityTokens));
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
 * (#2361).
 *
 * The roster arm is only as precise as the roster is free of ordinary words, so a
 * topical name IS refusable when its eponym-position token happens to be someone's
 * surname. How often that bites depends on WHICH roster a caller supplies, and no
 * single measurement covers them all: 735 of 4209 surnames in the Researcher
 * collection are also dictionary words, and measured on Dev at beta `2a8b6739` all
 * 16 roster-only refusals from THAT roster were genuine grafts, with "Belief Lab" /
 * "The UPLiFT Lab" / "CMB Lab" untouched because those tokens are absent from it.
 * The YSM harvest passes a wider roster (the whole A-Z directory, staff and trainees
 * included) and therefore accepts a wider collision envelope, unmeasured. Both are
 * properties of a corpus, not of the rule, so do not restate either as "a topical
 * name is not a surname" (#2368).
 */
export function claimsAnotherPersonsLab(args: {
  harvestedName: unknown;
  websiteUrl: unknown;
  identityTokens: string[];
  knownPersonSurnames: ReadonlySet<string>;
}): boolean {
  if (args.identityTokens.length === 0) return false;
  const pathCorroborated = corroboratedLabNameEponyms(args.harvestedName, args.websiteUrl);
  // The path named a person, so it has already answered the question either way;
  // the roster must not overturn "this is the eponym holder's own lab".
  if (pathCorroborated.length > 0) {
    return !pathCorroborated.some((eponym) => eponymMatchesIdentity(eponym, args.identityTokens));
  }
  const rosterCorroborated = eponymousLabNameSurnameCandidates(args.harvestedName).filter(
    (candidate) => args.knownPersonSurnames.has(candidate),
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
 * the link. A slot whose blurb NAMES what it links as a center, collaborative, or
 * consortium is declaring an affiliation even when its name reads as a lab, and
 * that blurb is the only evidence distinguishing the two (#2361). See
 * `describesAffiliatedOrganization` for why a passing mention does not count.
 *
 * `knownPersonSurnames` is the roster the eponym check corroborates against; see
 * `claimsAnotherPersonsLab`. Required, so a caller with no roster has to reach for
 * `claimsAnotherPersonsLabByUrlPath` and own that choice (#2368).
 *
 * `recordCitedUrls` are the URLs the harvest slot puts forward as this person's own,
 * which is what the shared-academic-host arm reads (#2360). Optional because the
 * evidence is a property of the lane rather than of the name: a lane with a linked
 * site in hand passes it and refuses the graft at harvest, and a lane without one
 * stays exactly as strong as it was. The refusal has to live here rather than in one
 * scraper, because `retireAffiliatedOrgNameGrafts` retires what the writers refuse,
 * and a writer that keeps minting the graft leaves the repair re-reporting the same
 * row after every scrape.
 */
export function classifyHarvestedResearchHomeName(args: {
  harvestedName: unknown;
  personName: unknown;
  websiteUrl?: unknown;
  harvestedDescription?: unknown;
  knownPersonSurnames: ReadonlySet<string>;
  recordCitedUrls?: unknown;
}): HarvestedNameIdentityVerdict {
  const name = stripResearchHomeNameLinkWrapper(args.harvestedName);
  if (name.length < 2) return 'UNUSABLE';
  if (isNonIdentifyingLinkLabelName(name)) return 'NON_IDENTIFYING_LABEL';
  if (isPersonPageLinkLabelName(name)) return 'NON_IDENTIFYING_LABEL';
  if (nameCarriesPersonIdentity(name, args.personName)) return 'OWN_IDENTITY';
  if (isUmbrellaOrganizationName(name)) return 'AFFILIATED_ORGANIZATION';
  if (describesAffiliatedOrganization(args.harvestedDescription)) {
    return 'AFFILIATED_ORGANIZATION';
  }
  // The shared host organization IS an organization this person is merely affiliated
  // with, so it settles to the verdict every caller already refuses rather than to a
  // new one they would each have to learn.
  if (
    nameNamesACitedSharedAcademicHost({
      harvestedName: name,
      recordCitedUrls: args.recordCitedUrls,
      identityTokens: personIdentityTokens(args.personName),
    })
  ) {
    return 'AFFILIATED_ORGANIZATION';
  }
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
 *
 * Two named entry points rather than one optional-roster parameter, for the same
 * reason as `claimsAnotherPersonsLab`: four of this predicate's five callers cannot
 * afford a corpus-wide roster (the DTO path is synchronous and per-request), and an
 * optional argument let them select the weaker judgement by omitting it, silently
 * making this backstop weaker than the harvest-time classifier it backs up (#2368).
 * `...ByUrlPath` is the weaker one and says so in its name.
 */
export interface PersonScopedNameIdentityArgs {
  candidateName: unknown;
  entityType?: unknown;
  kind?: unknown;
  slug?: unknown;
  personName?: unknown;
  websiteUrl?: unknown;
  /**
   * Every URL the record cites as its own, which is a different question from
   * `websiteUrl`: that one is the page the candidate name was harvested from and
   * corroborates whose eponym it is, while these are the pages the record puts
   * itself forward with. The shared-host arm needs the second, because the graft it
   * catches arrives from a faculty directory and names a host the record cites
   * elsewhere (#2360).
   *
   * Citations rather than the resolved `websiteUrl`, because the resolver refuses a
   * shared host's root to a person-scoped row (#2359) and so erases this evidence
   * exactly on the rows that need it. The citation survives that refusal by design:
   * the page is real provenance for the person named on it.
   */
  recordCitedUrls?: unknown;
}

const nameNamesThisRecordsOwnPerson = (name: string, identityTokens: string[]): boolean =>
  eponymousOrganizationNameSurnameCandidates(name).some((eponym) =>
    eponymMatchesIdentity(eponym, identityTokens),
  );

// Flattened one level so a caller can hand over a single URL, a list, or the mix of
// the two a record naturally holds (`[websiteUrl, website, sourceUrls]`) without
// each of the five call sites growing its own array helper.
const citedUrlList = (value: unknown): unknown[] =>
  (Array.isArray(value) ? value : [value]).flatMap((entry) =>
    Array.isArray(entry) ? entry : [entry],
  );

/**
 * The two citation shapes that identify the shared host itself: its root, and a
 * `~user` tenant page under it. A deep page on the same host
 * (`stat.yale.edu/people/...`) is a directory reference and not a claim on the
 * host, so matching a name against it would let the loose initials rule condemn a
 * topical name whose words happen to spell the host label ("Statistical Theory and
 * Applied Topics" spells `stat`). Every #2360 graft cites one of these two shapes.
 */
const namesTheHostRatherThanAPageOnIt = (url: unknown): boolean =>
  isMultiTenantAcademicHostRootUrl(url) || isMultiTenantAcademicHostTenantPageUrl(url);

/**
 * Whether one citation is enough to condemn `name` as the shared host's rather than
 * the record's. Three things have to hold together, and each one is a separate way
 * the inverted read of an ownership match loses a correct research home:
 *
 * The citation names the host itself, root or `~user` tenant page, so a directory
 * reference deep on the host cannot stand in for a claim on it.
 *
 * The host's label identifies the host and nothing else, so a discipline-word label
 * cannot turn an innocent topical name into a graft ("Applied Math Lab" on
 * `math.mit.edu/~atenant/`).
 *
 * An initials-only match is read on a citation of the host ROOT alone. The label
 * standing among the name's words is verbatim evidence and holds on either shape,
 * but three letters are a coincidence a member's own lab in the host's own field can
 * reach - "Cell Signaling Lab" on `csl.yale.edu/~jdoe/` spells the Computer Systems
 * Lab's label without being it - and a tenant page is that member's own page, which
 * is legitimate provenance rather than a claim on the host. Citing the ROOT is
 * itself the claim (#2359 refuses that root to a person-scoped row), and it is what
 * every measured #2360 graft does, so pairing it with the weaker match is the arm's
 * whole exposure to the collision.
 */
const citationCondemnsHostName =
  (name: string) =>
  (url: unknown): boolean => {
    if (!namesTheHostRatherThanAPageOnIt(url)) return false;
    if (!multiTenantAcademicHostLabelIsDistinctive(url)) return false;
    const match = multiTenantAcademicHostNameMatch(name, url);
    if (match === 'HOST_LABEL_WORD') return true;
    return match === 'NAME_INITIALS' && isMultiTenantAcademicHostRootUrl(url);
  };

/**
 * Whether a harvested name is the name of a shared academic host the record cites,
 * and so names the host organization rather than the record.
 *
 * An umbrella laboratory that calls itself a Lab is a research home by every naming
 * rule this module has: "Computer Systems Lab at Yale" names a 13-faculty
 * cross-department laboratory and "Yale NLP Lab" names one person's group, and as
 * strings harvested from the same faculty-directory page shape they cannot be told
 * apart. Three name-axis candidates were measured on #2360 and each cost more
 * correct names than it recovered, so the discriminator has to come from the
 * acquisition axis.
 *
 * The shared academic host the record cites is that discriminator. A host that
 * publishes `~user` pages for its members is owned by the organization and never by
 * one member, which is already why the resolver refuses its root to a person-scoped
 * row (#2359); the host label being what the name spells is the evidence the name
 * itself lacks. Judged on CITATIONS rather than the resolved `websiteUrl`, because
 * that refusal erases the host from the field exactly on the rows this is for.
 *
 * The eponym escape stays: a host label that is also this record's own surname is
 * still that person's.
 */
export function nameNamesACitedSharedAcademicHost(args: {
  harvestedName: unknown;
  recordCitedUrls: unknown;
  identityTokens: string[];
}): boolean {
  const name = textValue(args.harvestedName);
  if (!name) return false;
  const citesTheHostItNames = citedUrlList(args.recordCitedUrls).some(
    citationCondemnsHostName(name),
  );
  if (!citesTheHostItNames) return false;
  // Both eponym vocabularies, because this arm judges lab-headed and
  // organization-headed names alike: the umbrella arm above only ever sees the
  // second, so its single check would let "Ursula Laboratory" on
  // `ursula.chem.yale.edu` read as somebody else's when it is that person's own.
  const eponyms = [
    ...eponymousOrganizationNameSurnameCandidates(name),
    ...eponymousLabNameSurnameCandidates(name),
  ];
  return !eponyms.some((eponym) => eponymMatchesIdentity(eponym, args.identityTokens));
}

/**
 * The shared front half: the shape gate, the link-wrapper strip, identity-token
 * resolution, the umbrella-organization arm, and the shared-academic-host arm.
 * Returns the settled verdict, or the tokens the caller's chosen foreign-lab check
 * needs.
 *
 * The shape gate reads the key as well as the type, because a graft that asserts
 * an organization's `entityType` alongside its name would otherwise disable this
 * whole judgement for exactly the rows it exists to catch (#2913). Scoped here
 * rather than inside `isPersonScopedResearchEntity`, which many other callers
 * legitimately use as a type question.
 */
function personScopedNameIdentityPrelude(
  args: PersonScopedNameIdentityArgs,
): { settled: boolean } | { settled?: undefined; name: string; identityTokens: string[] } {
  if (!isPersonScopedResearchEntity(args) && !entityKeyNamesOnlyThisPerson(args)) {
    return { settled: false };
  }
  const name = stripResearchHomeNameLinkWrapper(args.candidateName);
  if (name.length < 2) return { settled: false };
  const personTokens = personIdentityTokens(args.personName);
  const identityTokens = researchHomeIdentityTokens(args);
  if (nameCarriesIdentityToken(name, personTokens)) return { settled: false };
  if (isUmbrellaOrganizationName(name)) {
    return { settled: !nameNamesThisRecordsOwnPerson(name, identityTokens) };
  }
  if (
    nameNamesACitedSharedAcademicHost({
      harvestedName: name,
      recordCitedUrls: args.recordCitedUrls,
      identityTokens,
    })
  ) {
    return { settled: true };
  }
  return { name, identityTokens };
}

export function personScopedResearchEntityNameNamesSomethingElseByUrlPath(
  args: PersonScopedNameIdentityArgs,
): boolean {
  const prelude = personScopedNameIdentityPrelude(args);
  if (prelude.settled !== undefined) return prelude.settled;
  return claimsAnotherPersonsLabByUrlPath({
    harvestedName: prelude.name,
    websiteUrl: args.websiteUrl,
    identityTokens: prelude.identityTokens,
  });
}

export function personScopedResearchEntityNameNamesSomethingElse(
  args: PersonScopedNameIdentityArgs & { knownPersonSurnames: ReadonlySet<string> },
): boolean {
  const prelude = personScopedNameIdentityPrelude(args);
  if (prelude.settled !== undefined) return prelude.settled;
  return claimsAnotherPersonsLab({
    harvestedName: prelude.name,
    websiteUrl: args.websiteUrl,
    identityTokens: prelude.identityTokens,
    knownPersonSurnames: args.knownPersonSurnames,
  });
}

const ORGANIZATION_SUBJECT_DETERMINERS = new Set(['the', 'this', 'our', 'its']);

const MAX_ORGANIZATION_SUBJECT_MODIFIERS = 6;

// A leading clause that positions what follows rather than being the subject
// itself. Only these license reading the subject after the first comma, so an
// appositive ("Our lab, the Center for X, studies ...") is never mistaken for one.
const LEADING_ADJUNCT_OPENERS = new Set([
  'as',
  'at',
  'in',
  'within',
  'under',
  'through',
  'across',
  'throughout',
  'since',
  'during',
  'following',
  'after',
  'before',
  'together',
  'alongside',
  'with',
  'from',
  'by',
  'for',
  'housed',
  'based',
  'located',
  'situated',
  'founded',
  'established',
  'created',
  'formed',
  'launched',
  'supported',
  'funded',
  'affiliated',
  'part',
  'working',
  'building',
  'drawing',
]);

// Words that may continue a proper organization name between its head noun and the
// verb: a lower-case connector, or any further capitalized name word.
const ORGANIZATION_NAME_CONNECTORS = new Set(['of', 'for', 'at', 'in', 'on', 'and', 'the', '&']);

const ORGANIZATION_PREDICATE_VERBS = new Set([
  'is',
  'are',
  'was',
  'were',
  'has',
  'have',
  'had',
  'comprises',
  'consists',
  'includes',
  'provides',
  'provide',
  'offers',
  'offer',
  'serves',
  'serve',
  'supports',
  'support',
  'focuses',
  'focus',
  'studies',
  'study',
  'investigates',
  'investigate',
  'examines',
  'examine',
  'explores',
  'explore',
  'develops',
  'develop',
  'conducts',
  'conduct',
  'performs',
  'perform',
  'houses',
  'house',
  'hosts',
  'host',
  'brings',
  'bring',
  'works',
  'work',
  'aims',
  'aim',
  'seeks',
  'seek',
  'exists',
  'exist',
  'promotes',
  'promote',
  'advances',
  'advance',
  'fosters',
  'foster',
  'trains',
  'train',
  'educates',
  'educate',
  'leads',
  'lead',
  'operates',
  'operate',
  'maintains',
  'maintain',
  'delivers',
  'deliver',
  'partners',
  'partner',
  'collaborates',
  'collaborate',
  'specializes',
  'specialize',
  'specialises',
  'specialise',
  'represents',
  'represent',
  'unites',
  'unite',
  'connects',
  'connect',
  'coordinates',
  'coordinate',
  'oversees',
  'oversee',
  'administers',
  'administer',
  'manages',
  'manage',
  'funds',
  'fund',
  'awards',
  'award',
  'publishes',
  'publish',
  'welcomes',
  'welcome',
  'encourages',
  'encourage',
  'enables',
  'enable',
  'helps',
  'help',
  'uses',
  'use',
  'applies',
  'apply',
  'combines',
  'combine',
  'integrates',
  'integrate',
  'engages',
  'engage',
  'contributes',
  'contribute',
  'addresses',
  'address',
  'pursues',
  'pursue',
  'creates',
  'create',
  'builds',
  'build',
  'designs',
  'design',
  'generates',
  'generate',
  'produces',
  'produce',
  'evaluates',
  'evaluate',
  'assesses',
  'assess',
  'strives',
  'strive',
  'began',
  'facilitates',
  'facilitate',
  'treats',
  'treat',
  'sees',
  'see',
  'cares',
  'care',
  'aspires',
  'aspire',
  'stands',
  'stand',
  'remains',
  'remain',
  'became',
  'draws',
  'draw',
]);

const ORGANIZATION_SUBJECT_GENERIC_TOKENS = new Set(['yale', 'the', 'this', 'our', 'its', 'new']);

function leadingSentence(body: string): string {
  const match = /^[\s\S]{0,600}?[.!?](?=\s|$)/.exec(body);
  return (match ? match[0] : body).slice(0, 600).trim();
}

// "The research program", "this research group" and "the research profile" describe
// a person's own work, and the serve-time faculty relabel writes exactly those from
// a lab-headed subject, so a caller running after it must not read them as an
// organization.
const PERSON_OWNED_RESEARCH_SUBJECT_RE =
  /\bresearch\s+(?:program(?:me)?s?|groups?|profiles?|units?)\b/i;

const MAX_ORGANIZATION_NAME_CONTINUATION_WORDS = 8;

const bareWord = (word: string): string => word.replace(/[^\p{L}\p{N}&'’-]/gu, '');

const startsCapitalized = (word: string): boolean => /^[\p{Lu}(]/u.test(word);

// The verb has to attach to the noun phrase, so only proper-name continuation may
// stand between them. Anything else ends the subject, which is what keeps a
// partitive reading ("The clinical core of our work is ...") out of the rule.
// Returns how many words of name continuation the subject carries, or -1 when no
// predicate attaches.
function organizationSubjectContinuationBeforePredicate(remainder: string[]): number {
  for (let index = 0; index < remainder.length; index += 1) {
    if (index >= MAX_ORGANIZATION_NAME_CONTINUATION_WORDS) return -1;
    const word = remainder[index];
    const token = bareWord(word).toLowerCase();
    if (ORGANIZATION_PREDICATE_VERBS.has(token)) return index;
    if (!startsCapitalized(word) && !ORGANIZATION_NAME_CONNECTORS.has(token)) return -1;
  }
  return -1;
}

function organizationSubjectSpan(sentence: string): string {
  const words = sentence.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const first = bareWord(words[0]).toLowerCase();
  // A sentence that opens on a preposition puts its organization in an adjunct, not
  // in subject position: "At the Pediatric Primary Care Center, <person> provides
  // health care" is the person's own prose. Sentence-initial capitalization makes
  // the preposition look like the start of a proper name, so it has to be excluded
  // explicitly.
  if (LEADING_ADJUNCT_OPENERS.has(first)) return '';
  const startsWithDeterminer = ORGANIZATION_SUBJECT_DETERMINERS.has(first);
  if (!startsWithDeterminer && !startsCapitalized(words[0])) return '';
  const headIndex = words.findIndex((word, index) => {
    if (index === 0 && startsWithDeterminer) return false;
    if (index > MAX_ORGANIZATION_SUBJECT_MODIFIERS) return false;
    return UMBRELLA_ORGANIZATION_HEAD_RE.test(bareWord(word));
  });
  if (headIndex < 0) return '';
  if (!startsWithDeterminer) {
    // A bare organization head noun with no determiner and no name in front of it is
    // as likely to be an adjective on an ordinary noun: "Collaborative studies with
    // members of the Department ... are addressing" is the person's own research.
    if (headIndex === 0) return '';
    const nameWordsOnly = words
      .slice(0, headIndex + 1)
      .every(
        (word, index) =>
          startsCapitalized(word) ||
          (index > 0 && ORGANIZATION_NAME_CONNECTORS.has(bareWord(word).toLowerCase())),
      );
    if (!nameWordsOnly) return '';
  } else {
    const modifiersAreNameWords = words
      .slice(1, headIndex)
      .every(
        (word) =>
          startsCapitalized(word) ||
          !ORGANIZATION_NAME_CONNECTORS.has(bareWord(word).toLowerCase()),
      );
    if (!modifiersAreNameWords) return '';
  }
  const continuation = organizationSubjectContinuationBeforePredicate(words.slice(headIndex + 1));
  if (continuation < 0) return '';
  const subject = words.slice(0, headIndex + 1 + continuation).join(' ');
  if (RESEARCH_HOME_LAB_HEAD_RE.test(subject)) return '';
  if (PERSON_OWNED_RESEARCH_SUBJECT_RE.test(subject)) return '';
  return subject;
}

/**
 * The organization a body makes its subject, or '' when the body's subject is not
 * an organization. Exported so a caller can report which subject it refused.
 */
export function bodySubjectOrganizationName(value: unknown): string {
  const body = textValue(value);
  if (!body) return '';
  const sentence = leadingSentence(body);
  const direct = organizationSubjectSpan(sentence);
  if (direct) return direct;
  const commaIndex = sentence.indexOf(',');
  if (commaIndex <= 0) return '';
  const opener = sentence
    .slice(0, commaIndex)
    .split(/\s+/)[0]
    .replace(/[^\p{L}\p{N}'’-]/gu, '')
    .toLowerCase();
  if (!LEADING_ADJUNCT_OPENERS.has(opener)) return '';
  return organizationSubjectSpan(sentence.slice(commaIndex + 1).trim());
}

function organizationSubjectNamesThisRecord(
  subject: string,
  args: { name?: unknown; displayName?: unknown; slug?: unknown; personName?: unknown },
): boolean {
  if (nameCarriesPersonIdentity(subject, args.personName)) return true;
  // The same union `personScopedNameIdentityPrelude` judges on, not the lead name with
  // the key as a fallback: a lead-else-key ternary drops the key's spelling of the
  // surname whenever any lead resolves, which is exactly the spelling an apostrophe or
  // a diacritic name survives in (#2384).
  const identityTokens = researchHomeIdentityTokens(args);
  if (
    eponymousOrganizationNameSurnameCandidates(subject).some((eponym) =>
      eponymMatchesIdentity(eponym, identityTokens),
    )
  ) {
    return true;
  }
  const subjectTokens = nameWords(subject).filter(
    (word) =>
      word.length >= 3 &&
      !ORGANIZATION_SUBJECT_GENERIC_TOKENS.has(word) &&
      !UMBRELLA_ORGANIZATION_HEAD_RE.test(word) &&
      !ORGANIZATION_NAME_CONNECTORS.has(word),
  );
  if (subjectTokens.length === 0) return false;
  // The record's own NAME, never its slug: a slug's words are topical, so "cancer"
  // in `cancer-research-lab` would clear "Yale Cancer Center", which is the overlap
  // trap `personScopedResearchEntityNameNamesSomethingElse` already documents. Slug
  // tokens reach this judgement only through the eponym arm above.
  const recordTokens = new Set([...nameWords(args.name), ...nameWords(args.displayName)]);
  return subjectTokens.every((token) => recordTokens.has(token));
}

export interface PersonScopedBodySubjectArgs {
  description: unknown;
  name?: unknown;
  displayName?: unknown;
  slug?: unknown;
  personName?: unknown;
}

/**
 * Whether a body of prose OPENS by making a third-party organization its subject,
 * and so describes something other than the person-scoped record carrying it
 * (#2480).
 *
 * This is the body-shaped member of the same family as `isUmbrellaOrganizationName`
 * (a name) and `describesAffiliatedOrganization` (a link slot's blurb). None of the
 * three governs a served description, which is why a page linked from a profile's
 * single lab-website slot could have a department's or a core facility's prose
 * harvested onto one faculty member's row.
 *
 * It keys on WHOSE prose this is, never on whether the prose sounds research-like.
 * A lexical "is this research writing" test was measured and rejected on #2573: a
 * core facility's own description reads "We provide training and access to shared
 * confocal microscopes", which any such test refuses. Subject position is the
 * discriminator instead, and it has to be read rather than guessed:
 *
 *  - The subject must sit in TOPIC position, at the start of the first sentence or
 *    directly after one leading adjunct clause ("Housed under the <institute>, the
 *    PET core is ..."). An organization named anywhere else is a mention, which is
 *    the same distinction `describesAffiliatedOrganization` draws and the reason
 *    "Research in the Department of Psychiatry on adolescent sleep" survives.
 *  - A finite verb must follow the noun phrase, with only proper-name continuation
 *    between the two. Without it the partitive reading is indistinguishable from the
 *    organizational one: "The clinical core of our work is patient-centred" is the
 *    person's own prose and "The Department of Psychiatry is committed to" is not,
 *    and both put an organization head noun in the same place.
 *  - A lab-headed subject is never organizational, so "The Smith Lab studies" is
 *    untouched, on the same boundary `isUmbrellaOrganizationName` draws.
 *
 * The verb and connector vocabularies fail OPEN: a shape they do not recognize
 * keeps its body, so an unlisted verb costs recall and never costs a real
 * description.
 *
 * A record whose own identity IS the organization keeps its body, judged the same
 * three ways the name rule judges identity: the subject carries the person's name,
 * the subject's eponym is the record's person, or every distinctive word of the
 * subject is already in the record's own name. Without that arm a row named after
 * the organization it describes would lose the one description that is genuinely
 * its own.
 */
export function personScopedResearchEntityBodyDescribesAnotherOrganization(
  args: PersonScopedBodySubjectArgs,
): boolean {
  const subject = bodySubjectOrganizationName(args.description);
  if (!subject) return false;
  return !organizationSubjectNamesThisRecord(subject, args);
}

const BIOGRAPHY_SUBJECT_CREDENTIAL =
  'M\\.?D|Ph\\.?D|MBBS|MPH|D\\.?O|DVM|DDS|Sc\\.?D|Pharm\\.?D|D\\.?Phil|Dr\\.?PH|M\\.?S|M\\.?A|B\\.?A|J\\.?D';

const BIOGRAPHY_SUBJECT_VERB =
  'is|was|has|received|earned|holds|held|joined|serves|served|completed|obtained|graduated|attended|matriculated|studies|investigates|examines|explores|focuses|researches|works|leads|directs|chairs|teaches|writes|trained';

// A biography names its subject in sentence-initial position and puts a finite verb
// after the name. Anything later in the passage is a mention: a co-author, a
// dedicatee, a book title. Matching only the opening is what separates "Brandon
// Manor, MD, graduated from ..." from "... a collection entitled Grand Strategies
// in War and Peace. He helped draft ...".
const BIOGRAPHY_SUBJECT_LEAD = new RegExp(
  `^(?:(?:Dr|Prof|Professor)\\.?\\s+)?([A-Z][\\p{L}'’-]+(?:\\s+(?:[A-Z]\\.|van|von|de|del|della|di|da|la|le|[A-Z][\\p{L}'’-]+)){1,3})(?:,\\s*(?:${BIOGRAPHY_SUBJECT_CREDENTIAL})\\.?)*,?\\s+(?:${BIOGRAPHY_SUBJECT_VERB})\\b`,
  'u',
);

const foldedNameTokens = (value: unknown): string[] =>
  nameWords(textValue(value).normalize('NFD').replace(/\p{M}/gu, '')).filter(
    (word) => word.length >= 2 && !PERSON_NAME_STOP_WORDS.has(word),
  );

/**
 * The person a biography makes its subject, or '' when the opening does not name
 * one. Exported so a caller can report whose biography it refused.
 */
export function biographySubjectPersonName(value: unknown): string {
  const body = textValue(value);
  if (!body) return '';
  return BIOGRAPHY_SUBJECT_LEAD.exec(leadingSentence(body))?.[1]?.trim() ?? '';
}

/**
 * Whether a person-scoped record's synthesized biography is about a DIFFERENT
 * person who shares a name with the record's own (#1922).
 *
 * `profileSynthesisDescription` is a biography by construction, so unlike the
 * organization rule above this one does not have to decide whether the prose is
 * person-shaped. It has to decide WHOSE person it is, and the discriminator is the
 * surname: a graft of this class reaches the row because a first name matched, and
 * it survives an identity refresh because nothing compares the synthesis prose
 * against the record's identity the way `detectProfileIdentityRisk` compares URLs.
 *
 * A shared name token is REQUIRED, not incidental. Refusing on an absent surname
 * alone would refuse every organizational record whose PI's surname is in neither
 * its name nor its slug, which is an ordinary and correct shape. Requiring the
 * collision costs recall on a graft that shares no name at all, and that is the
 * deliberate trade: measured over the 343 live Development rows carrying a
 * synthesis, the collision rule refuses 1 and the surname-absent rule refuses 30,
 * 29 of which are the record's own biography.
 *
 * Diacritics are folded on both sides because `nameWords` splits on them, so
 * "Hägglund" would otherwise never match the record's own "Hagglund".
 */
export function personSynthesisDescribesAnotherPerson(args: PersonScopedBodySubjectArgs): boolean {
  const subject = biographySubjectPersonName(args.description);
  if (!subject) return false;
  const subjectTokens = foldedNameTokens(subject);
  if (subjectTokens.length < 2) return false;
  const surname = subjectTokens[subjectTokens.length - 1];
  if (surname.length < 3) return false;

  const identityTokens = Array.from(
    new Set([
      ...foldedNameTokens(args.personName),
      ...foldedNameTokens(args.name),
      ...foldedNameTokens(args.displayName),
      ...foldedNameTokens(textValue(args.slug).replace(/-/g, ' ')),
    ]),
  );
  if (identityTokens.length === 0) return false;
  if (eponymMatchesIdentity(surname, identityTokens)) return false;
  return subjectTokens
    .slice(0, -1)
    .some((token) => token.length >= 3 && identityTokens.includes(token));
}
