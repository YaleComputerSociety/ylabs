import {
  hasContactBlockResidue,
  isCitationAuthorListDumpText,
  isConnectedToKeywordListStub,
  isInstitutionalCenterBlurbText,
  isStaleResearchAreaChipEnumeration,
  isStudiesResearchAreaEchoDescription,
  sanitizeResearchEntityDescription,
  sanitizeResearchEntityShortDescription,
} from './descriptionHygiene';
import { collapseDuplicateResearchHomeSuffix } from './researchEntityNameNormalization';
import { normalizeResearchAreaList } from './researchAreaHygiene';
import { sanitizeResearchAreaLabel } from './researchAreaLabelHygiene';
import { filterProseResearchAreaChips } from './profileResearchTerms';
import { dropDomainIncoherentUnsourcedResearchAreas } from './researchAreaDomainCoherence';
import { isCareerFactSentence, splitDescriptionSentences } from './careerBiographyDescription';
import { isProgramLikeResearchEntity } from './researchEntityProgramLike';
import {
  isPersonScopedResearchEntity,
  isPlaceholderEntityName,
  personScopedResearchEntityBodyDescribesAnotherOrganization,
  personScopedResearchEntityNameFromLeadPersonName,
  personScopedResearchEntityNameFromPersonName,
  personScopedResearchEntityNameNamesSomethingElseByUrlPath,
  personSynthesisDescribesAnotherPerson,
} from './researchHomeNameIdentityAuthority';

const DESCRIPTION_FIELDS = ['shortDescription', 'fullDescription'] as const;
const DESCRIPTION_AND_SYNTHESIS_FIELDS = [
  ...DESCRIPTION_FIELDS,
  'profileSynthesisDescription',
] as const;

const HYGIENE_FULL_DESCRIPTION_FIELDS = ['fullDescription', 'profileSynthesisDescription'] as const;
// This is a curated allowlist, not a mechanical inflection table: some
// inflections of a listed verb carry no research signal in bio prose
// ("currently developing a new feature" in a filmmaker CV), so a missing
// inflection may be deliberate. Only add one whose every reading is a research
// signal, as `researches`/`researching`/`studied`/`investigating` are (#1921:
// their absence blanked "Roberts researches the histories of medicine ...,
// investigating how ..." purely on verb tense), and as the progressive of the
// already-listed "works on" is ("I'm currently working on William Cobbett" is
// the same claim as "works on William Cobbett", and its absence blanked an
// eighteenth-century literature statement off the served surface entirely).
const NON_MATCHED_PROFILE_SUMMARY_RESEARCH_HINT =
  /\b(?:research|researches|researching|lab|laboratory|study|studies|studying|studied|investigate|investigates|investigated|investigating|explore|explores|explored|exploring|focus|focuses|focusing|focused|work(?:s|ing)?\s+on|conducts|uses|using|develops|examine|examines|examined|examining|observe|observes|observed|observing|analysis|method|methods|model|models|modeled|modeling|projects?|theory|algorithm|algorithms|approach|approaches|data|paper|papers?|publications?)\b/i;

type FacultyResearchTextEntity = {
  displayName?: string | null;
  name?: string | null;
  kind?: string | null;
  entityType?: string | null;
};

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

const LEAD_NAME_TOKENIZERS = [/\bdr\.?\b/gi, /\bprof\.?\b/gi, /\bprofessor\b/gi, /\bm\.?d\.?\b/gi];

function normalizePersonNameTokens(value: unknown): string[] {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) =>
      LEAD_NAME_TOKENIZERS.reduce((next, pattern) => next.replace(pattern, ''), token),
    )
    .map((token) => token.trim())
    .filter(Boolean);
}

// Includes the academic leadership titles a Yale profile uses in place of an
// honorific ("Dean Crane's work ..."), because left in the token stream a title
// occupies the given-name slot and the reference stops matching its own lead.
const PERSON_NAME_HONORIFIC_TOKEN =
  /^(?:dr|drs|prof|professor|mr|mrs|ms|mx|md|phd|sir|dame|dean|chair|provost|president|chancellor|rector|emeritus|emerita)$/;
const PERSON_NAME_GENERATION_SUFFIX_TOKEN = /^(?:jr|jnr|sr|snr|ii|iii|iv)$/;

/**
 * A capitalized word that opens a SENTENCE rather than a name. The possessive
 * prefix pattern reads the whole leading capitalized run as one name, so "The
 * Center's mission", "Since Yale University's founding" and "Throughout Dr.
 * Feuerstadt's career" all arrive here looking like a five-token person name.
 * Without this, the sentence word occupies the given-name slot and the real
 * surname never lines up against a lead, so the strip fires on an organization's
 * or a disease's possessive (#2240: "The Yale Alzheimer's Disease Research Unit"
 * lost its opening clause on the served card).
 */
const NON_NAME_LEADING_TOKEN =
  /^(?:the|a|an|this|that|these|those|about|after|as|at|before|both|by|during|for|from|in|on|since|through|throughout|to|under|when|where|while|with|although|because|all|every|his|her|their|our|its)$/;

/**
 * Page chrome a harvest carried into the copy ahead of the possessive: "About
 * Hollis Quintrell's research focuses on ...". It is dropped before the run is
 * judged, for the same reason `givenNamesAgree` reads through the run-together
 * "AboutDavid" shape - the chrome word is a harvest defect rather than evidence
 * about who is being described - so the remainder is tested as the name it is.
 * Unlike a sentence opener ("Throughout Dr. Fenwick's career ..."), chrome is not
 * part of the sentence, so removing the whole run still leaves a grammatical line.
 */
const PAGE_CHROME_LEADING_TOKEN = /^(?:about|overview|profile|biography|bio)$/;

const MIN_CHROME_STRIPPED_NAME_TOKENS = 2;

/**
 * Only strips when a plausible full name is left behind, because these chrome words
 * also open a sentence about a topic. "About Alzheimer's disease ..." leaves one
 * token, and treating a lone eponym as a surname made the strip blank an
 * explainer body outright; "About Hollis Quintrell's ..." leaves two and is the
 * harvest shape this exists for. A one-token remainder is left attached so the
 * sentence-opener check sees the chrome word and keeps the line.
 */
function withoutLeadingPageChrome(candidate: string): string {
  const words = candidate.split(/\s+/).filter(Boolean);
  let start = 0;
  while (
    start < words.length &&
    PAGE_CHROME_LEADING_TOKEN.test(normalizePersonNameTokens(words[start])[0] || '')
  ) {
    start += 1;
  }
  if (start === 0) return candidate;
  const remainder = words.slice(start).join(' ');
  const remainderTokens = personNameParts(remainder)?.coreTokens.length ?? 0;
  return remainderTokens >= MIN_CHROME_STRIPPED_NAME_TOKENS ? remainder : candidate;
}

/**
 * A possessive whose HEAD noun is an organization or an artefact rather than a
 * person: "Gary Desir Research's mission", "The Olin NRC's". Only the head is
 * judged, because a person's name can legitimately contain any of these words
 * earlier in the phrase.
 */
const NON_PERSON_POSSESSIVE_HEAD_NOUN =
  /^(?:research|centre|center|institute|institution|lab|labs|laboratory|laboratories|unit|program|programme|project|university|college|school|department|division|section|group|initiative|consortium|network|hospital|clinic|foundation|society|association|office|committee|core|facility|team|disease|syndrome|award|prize|fellowship|library|museum|press)$/;

interface PersonNameParts {
  /** Name tokens of more than one character, honorific and suffix removed. */
  coreTokens: string[];
  surname: string;
  givenNames: string[];
  /** Single-character tokens, which carry a given or middle name rather than a surname. */
  initials: Set<string>;
}

function personNameParts(value: string): PersonNameParts | null {
  const tokens = normalizePersonNameTokens(value).filter(
    (token) =>
      !PERSON_NAME_HONORIFIC_TOKEN.test(token) && !PERSON_NAME_GENERATION_SUFFIX_TOKEN.test(token),
  );
  const coreTokens = tokens.filter((token) => token.length > 1);
  if (!coreTokens.length) return null;
  return {
    coreTokens,
    surname: coreTokens[coreTokens.length - 1],
    givenNames: coreTokens.slice(0, -1),
    initials: new Set(tokens.filter((token) => token.length === 1)),
  };
}

function possessivePrefixNamesAPerson(candidate: string): boolean {
  const tokens = normalizePersonNameTokens(candidate);
  if (!tokens.length || NON_NAME_LEADING_TOKEN.test(tokens[0])) return false;
  const parts = personNameParts(candidate);
  return Boolean(parts) && !NON_PERSON_POSSESSIVE_HEAD_NOUN.test(parts!.surname);
}

const FAMILIAR_GIVEN_NAME_STEM_LENGTH = 3;

function sharesFamiliarGivenNameStem(first: string, second: string): boolean {
  let shared = 0;
  while (shared < first.length && shared < second.length && first[shared] === second[shared]) {
    shared += 1;
  }
  return shared >= FAMILIAR_GIVEN_NAME_STEM_LENGTH;
}

/**
 * Two references to a person agree on the given name, allowing for the ways a
 * directory and a roster row disagree about one: a legal name against a familiar one
 * sharing its stem ("Judith A. Chevalier" for a lead recorded as "Judy Chevalier"), a
 * shortened form ("Pete" for "Peter"), or a double surname whose first half the roster
 * stored as an initial ("O'Connor Duffany" against "Kathleen O. Duffany").
 *
 * The familiar-form arm needs a shared STEM, not a shared first letter. A shared
 * initial alone reads every same-surname relative as the lead ("Jonathan Marchetti's"
 * on a record led by Judy Marchetti), which is the third-party graft the surname veto
 * exists to catch.
 *
 * A reference carrying no given name at all agrees by default, because an honorific
 * standing in for it ("Dr. Perman") says nothing either way. That is the common case:
 * 84 of the 207 corpus firings had this shape.
 *
 * The suffix arm covers a harvest that glued page chrome onto the name with no
 * separator, which reaches this as one token ("AboutDavid" for "David"), so it is
 * narrowed to exactly that: the removed prefix must itself be a chrome word, and only
 * the harvested side may carry it. A roster display name comes from a stored
 * `Researcher.displayName` and never carries harvest chrome, so the mirror direction
 * has no justification and would read a shortened relative's name ("Ana" against a
 * lead recorded as "Juliana") as the lead itself.
 */
function givenNameIsChromePrefixed(given: string, leadGiven: string): boolean {
  if (given.length <= leadGiven.length || !given.endsWith(leadGiven)) return false;
  return PAGE_CHROME_LEADING_TOKEN.test(given.slice(0, given.length - leadGiven.length));
}

function givenNamesAgree(candidate: PersonNameParts, lead: PersonNameParts): boolean {
  if (!candidate.givenNames.length || !lead.givenNames.length) return true;
  return candidate.givenNames.some(
    (given) =>
      lead.initials.has(given[0]) ||
      lead.givenNames.some(
        (leadGiven) =>
          leadGiven === given ||
          leadGiven.startsWith(given) ||
          given.startsWith(leadGiven) ||
          givenNameIsChromePrefixed(given, leadGiven) ||
          sharesFamiliarGivenNameStem(leadGiven, given),
      ),
  );
}

/**
 * Does this possessive name one of the record's own leads?
 *
 * The discriminator is the SURNAME. Requiring the given name to appear verbatim in
 * the lead's tokens made the guard blind to every way a source actually refers to
 * its own subject, and the miss rate was total: of 207 firings over the live
 * `student_ready` corpus, every single one named the record's own lead or was not a
 * person at all, and none named a third party (#2240).
 *
 * The surname is matched against the whole of the other side's name rather than only
 * its final token, in both directions, because either side can carry an extra
 * trailing token: a stored lead name can end in a post-nominal credential ("Puja
 * Mehta, MBBS") and a harvested reference can end in the record's own suffix ("Gray
 * Dessein Research"). Enumerating credentials is not safe here, since several of
 * them ("Ma", "Do", "Ms") are also real surnames.
 *
 * The given name is then a veto rather than a requirement, so a genuine third-party
 * attribution is still stripped even when it shares the lead's surname: a possessive
 * naming a different member of the same family does not survive on the surname alone.
 */
function leadNamesMatchTextValue(candidate: string, leadMemberNames: readonly string[]): boolean {
  const candidateParts = personNameParts(candidate);
  if (!candidateParts) return false;

  return leadMemberNames.some((leadName) => {
    const leadParts = personNameParts(leadName);
    if (!leadParts) return false;
    const surnamesAlign =
      leadParts.coreTokens.includes(candidateParts.surname) ||
      candidateParts.coreTokens.includes(leadParts.surname);
    return surnamesAlign && givenNamesAgree(candidateParts, leadParts);
  });
}

// A card synthesized from research prose opens with a research-description verb
// ("Studies Ménétrier's disease", "Studies Ivan Goncharov's travelogue"): here the
// capitalized possessive is the eponymous object of study, not the entity's own
// lead name, so the mismatched-person-name strip below must not fire and blank it.
const RESEARCH_LEAD_VERB_PREFIX_TOKEN =
  /^(?:studies|study|investigates|investigate|examines|examine|explores|explore|develops|develop|focuses|focus|focused|advances|advance|supports|support|fosters|foster|combines|combine|conducts|conduct|builds|build|designs|design|creates|create|analyzes|analyze|analyses|analyse|models|model|measures|measure|researches|research|seeks|seek|works|work|uses|use|employs|employ|innovates|innovate|enhances|enhance|improves|improve|unites|unite|provides|provide)$/i;

// The orphaned-pronoun re-voice pass synthesizes exactly this shape ("<Entity
// name>'s research focuses on ..."), and `sanitizeFacultyResearchEntityCopyFields`
// runs the strip below again on that already-re-voiced text, where `leadMemberNames`
// is the roster rather than the entity name and so cannot vouch for it. Without this
// bypass the strip blanks a body the pipeline itself re-voiced (#1871).
function namesEntityItself(candidate: string, entity?: FacultyResearchTextEntity | null): boolean {
  if (!entity) return false;
  const baseName = facultyResearchLabelBase(entity);
  if (!baseName) return false;
  return (
    normalizePersonNameTokens(candidate).join(' ') === normalizePersonNameTokens(baseName).join(' ')
  );
}

function sanitizeLeadingMismatchedPersonNamePrefix(
  value: string,
  leadMemberNames: readonly string[] = [],
  entity?: FacultyResearchTextEntity | null,
): string {
  if (!leadMemberNames.length) return value;
  const match = value.match(/^([A-Z][\p{L}.'’-]+(?:\s+[A-Z][\p{L}.'’-]+){1,4})['’]s\s+/u);
  if (!match) return value;
  if (RESEARCH_LEAD_VERB_PREFIX_TOKEN.test(match[1].split(/\s+/)[0])) return value;
  const possessive = withoutLeadingPageChrome(match[1]);
  if (!possessivePrefixNamesAPerson(possessive)) return value;
  if (leadNamesMatchTextValue(possessive, leadMemberNames)) return value;
  if (namesEntityItself(possessive, entity)) return value;
  const remainder = value.slice(match[0].length);
  if (!NON_MATCHED_PROFILE_SUMMARY_RESEARCH_HINT.test(remainder)) return '';
  return `This ${remainder}`;
}

function isLikelyResearchFocusedText(value: string): boolean {
  return NON_MATCHED_PROFILE_SUMMARY_RESEARCH_HINT.test(textValue(value));
}

const PROFILE_SYNTHESIS_DESCRIPTION_FIELD = 'profileSynthesisDescription';

// The guard fires only when the WHOLE field carries no research signal, so
// there is never a research-bearing remainder to keep: sentence-granular repair
// (the #1586 shape used by `repairFacultyBiographyOpener`) cannot apply here.
// Both `sanitizeResearchEntityPublicDescriptionFields` and
// `sanitizeFacultyResearchEntityCopyFields` must call this one definition; the
// second was a copy that drifted out of sight and made the first invisible
// during triage (#1921).
//
// `descriptionSource: 'PI_PROFILE_SYNTHESIS'` is a legacy stored value: this
// guard is its only reader and no code path writes it, so on a row that has since
// won a higher-confidence description the flag describes text that is no longer
// there. The field's own provenance is what says whose text is being served, so a
// field whose provenance names a source is source-backed and is judged on its
// content by the closers that read content, not blanked on a flag about an
// earlier value. `profileSynthesisDescription` is exempt from the exemption: it is
// the profile-synthesis field by name, and none of the 341 Development rows
// carrying the flag records provenance for it at all.
function guardNonResearchProfileSynthesisText(
  value: string,
  entity: { descriptionSource?: unknown; fieldProvenance?: unknown },
  field: string,
): string {
  if (String(entity.descriptionSource) !== 'PI_PROFILE_SYNTHESIS') return value;
  if (field !== PROFILE_SYNTHESIS_DESCRIPTION_FIELD && fieldProvenanceNamesASource(entity, field)) {
    return value;
  }
  return isLikelyResearchFocusedText(value) ? value : '';
}

function fieldProvenanceNamesASource(
  entity: { fieldProvenance?: unknown },
  field: string,
): boolean {
  const provenance = entity.fieldProvenance as Record<string, any> | undefined | null;
  const entry = provenance && typeof provenance === 'object' ? provenance[field] : null;
  if (!entry || typeof entry !== 'object') return false;
  return textValue((entry as Record<string, unknown>).sourceName).length > 0;
}

function compactText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const DIRECTORY_INDEX_CHROME_PATTERNS = [
  /\bA[\s.–—-]?Z index\b.{0,160}\blab websites\b/i,
  /\blab websites in one place\b/i,
  /\bbrowse alphabetically\b/i,
];

export function isDirectoryIndexChromeText(value: unknown): boolean {
  const cleaned = textValue(value);
  if (!cleaned) return false;
  return DIRECTORY_INDEX_CHROME_PATTERNS.some((pattern) => pattern.test(cleaned));
}

/**
 * Prose that narrates the SOURCE PAGE instead of describing the research: "The
 * page lists Dr. Lichak's professional interests in ...", "Faculty page lists
 * faculty interests in consumer finance ...".
 *
 * An extractor that reports what it saw rather than what the research is has
 * failed at its job even when every fact in the sentence is true, so this fails
 * closed on the shape rather than trying to judge the content. It is also the
 * only guard that catches the worst member of the family, where the narrated page
 * is an index and the person named is somebody else entirely: `dept-som-a-david-paltiel`
 * and `dept-som-david-c-tate` both carried "The faculty page lists Marian Chertow
 * whose work relates to industrial environmental management", harvested from
 * `som.yale.edu/faculty-research/faculty-directory?page=1`. The mismatched-name
 * guard does not fire on a third-party attribution, so without this the copy
 * reaches the page (#2063 batch review).
 */
const SOURCE_PAGE_NARRATION_PATTERNS = [
  /\b(?:the\s+|this\s+)?(?:faculty|directory|profile|department|departmental|listing|web)?\s*page\s+(?:lists|shows|displays|contains|includes|features|mentions|names|indicates|describes)\b/i,
  /\bthis\s+(?:page|site|directory|listing)\s+(?:lists|shows|displays|contains)\b/i,
  /\bthe\s+(?:directory|listing|roster|index)\s+(?:lists|shows|contains|names)\b/i,
];

export function isSourcePageNarrationDescription(value: unknown): boolean {
  const cleaned = textValue(value);
  if (!cleaned) return false;
  return SOURCE_PAGE_NARRATION_PATTERNS.some((pattern) => pattern.test(cleaned));
}

export function isResearchEntitySourceChromeText(value: unknown): boolean {
  const cleaned = textValue(value);
  if (!cleaned) return false;
  const compact = compactText(cleaned);
  if (
    [
      'administrationncidesignationhistory',
      'communityoutreachcommunityadvisoryboardprograms',
      'patientinformationcancertypes',
      'bythenumbersinformationresourcesresearchtrainingmeetourteam',
      'ysmhomeinformationforaboutysmfacultystaffstudentsresidentsfellowspatientsresearchersalumni',
      'viewdoctorprofileadditionaltitles',
      'viewthisdoctorsclinicalprofile',
      'currentmemberscollaboratorslablifealumni',
      'getinvolvedparticipatecontactus',
      'menutoggleextendednavigation',
      'exploreresearchmeetthelababoutabout',
      'peopleeventsresearchcoursesopportunitiesnewsresearch',
      'facultyresearchinitiativesarecurrentlyactive',
    ].some((fragment) => compact.includes(fragment))
  ) {
    return true;
  }
  if (hasContactBlockResidue(cleaned) || isCitationAuthorListDumpText(cleaned)) return true;
  return [
    /\byou are here\b/i,
    /[»›][^»›]{1,80}[»›]/,
    /\b\d{4}-\d{4}-\d{4}-\d{3}[\dX]\b/i,
    /\bORCID\s*/i,
    /Publications\s*Timeline/i,
    /\bYSM Researchers?\b/i,
    /ResearchersView/i,
    /View\s+(?:Lab Website|Full Profile|Related Publications?|Related Publication)/i,
    /View\s+\d+\s+(?:Common|Related)\s+Publications?/i,
    /\b(?:Common|Related)\s+Publications?\b/i,
    /Yale Co-Authors/i,
    /Streamline Icon/i,
    /^eduHQ\s*\d/i,
    /\bCitations\b/i,
  ].some((pattern) => pattern.test(cleaned));
}

export function isBrokenResearchEntityDescriptionFragment(value: unknown): boolean {
  const cleaned = textValue(value);
  if (!cleaned) return false;
  return (
    /^Dr[.,]\s+(?:using|with|in|and)\b/i.test(cleaned) ||
    /^(?:focuses\s+in|of\s+|is\s+in\s+)/i.test(cleaned) ||
    /\b(?:and|with|by)\s+(?:[A-Z][a-z]+\s+[A-Z]\.|[A-Z]\.|Dr\.)$/.test(cleaned) ||
    /\b(?:with|by)\s+[A-Z][a-z]+\.$/.test(cleaned)
  );
}

const MID_CV_CONTINUATION_OPENER_PATTERN =
  /^(?:Next,|Subsequently,|After completing\b|In \d{4},\s+(?:he|she|they)\b)/i;

/**
 * A description field that opens mid-CV, continuing a biography narrative cut
 * from elsewhere in the source page (#1456: "Next, he completed his graduate
 * studies..."). Distinct from `isBrokenResearchEntityDescriptionFragment`,
 * which catches fragments broken at the end rather than a resumed opener.
 */
export function isMidCvContinuationOpener(value: unknown): boolean {
  const cleaned = textValue(value);
  return Boolean(cleaned) && MID_CV_CONTINUATION_OPENER_PATTERN.test(cleaned);
}

export function isSyntheticResearchHomeMetadataDescription(value: unknown): boolean {
  const cleaned = textValue(value);
  if (!cleaned) return false;
  return (
    [
      /^research home connected to\b.*\.$/i,
      /^research home focused on\b.*\.$/i,
      /^.+ is a Yale research home(?: connected to\b.*)?\. This context is synthesized from indexed Yale(?: source)? metadata and should be checked against (?:the linked official sources|official sources before outreach)\.$/i,
      /\band\s*\./i,
      /\bconnected to\s*\./i,
    ].some((pattern) => pattern.test(cleaned)) ||
    // Shared with backfillDescriptionQualityCore's TEMPLATED classifier (#1511).
    isConnectedToKeywordListStub(cleaned)
  );
}

export function isResearchAreaPlaceholderDescription(value: unknown): boolean {
  const cleaned = textValue(value);
  if (!cleaned) return false;
  return /^research areas?\s*(?::|include\b)/i.test(cleaned);
}

export function isAcademicAppointmentDescription(value: unknown): boolean {
  const cleaned = textValue(value);
  // The appointment patterns below identify a short title-only fragment ("X
  // is Associate Professor of Y"). A long multi-sentence description that
  // happens to open with that same sentence is not appointment-only - it is
  // a research description with an orienting lead-in - so this check does
  // not apply past a single-sentence-ish length (#1456: this false-positive
  // was misclassifying real research prose as appointment-only whenever the
  // research verbs elsewhere in the text used a different inflection than
  // hasResearchDescriptionVerb's fixed list, e.g. "to develop", "investigation of").
  if (!cleaned || cleaned.length > 300) return false;
  const hasResearchDescriptionVerb =
    /\b(studies|investigates|examines|explores|focuses on|works on|develops|uses|employs)\b/i.test(
      cleaned,
    );
  if (hasResearchDescriptionVerb) return false;

  return [
    /^Department Chair\b.*\bProfessor of\b/i,
    /\bProfessor of\b.*;\s*Affiliated Faculty\b/i,
    /\bProfessor of\b.*\bDirector,\s+Yale\b/i,
    /^[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)+\s+is\s+(?:an?\s+)?(?:Assistant|Associate|Full|Adjunct|Clinical|Visiting)?\s*Professor\b/i,
    /\b(?:Assistant|Associate|Full|Adjunct|Clinical|Visiting)?\s*Professor\b.*\bPrincipal Investigator\b/i,
    /\bPrincipal Investigator\b.*\b(?:Assistant|Associate|Full|Adjunct|Clinical|Visiting)?\s*Professor\b/i,
    /\bholds?\s+(?:an?\s+)?(?:secondary|joint|dual)\s+appointment\s+as\b/i,
  ].some((pattern) => pattern.test(cleaned));
}

export function isRoleOnlyTitleFragment(value: unknown): boolean {
  const cleaned = textValue(value);
  if (!cleaned || cleaned.length > 120) return false;
  const titlePatterns = [
    /^(?:track\s+)?director\b(?:\s+of\b|,|\s+-|\s+\(|$)/i,
    /^(?:co-)?director\b(?:\s+of\b|,|\s+-|\s+\(|$)/i,
    /^(?:assistant|associate|full|adjunct|clinical|visiting)?\s*professor\b(?:\s+of\b|,|\s+-|\s+\(|$)/i,
    /^(?:principal\s+investigator|faculty|lecturer|instructor)\b(?:\s+of\b|,|\s+-|\s+\(|$)/i,
    /\b(?:course|program|track|site|center|centre|department)\s+director\b/i,
  ];
  if (titlePatterns.some((pattern) => pattern.test(cleaned))) return true;

  const hasResearchDescriptionVerb =
    /\b(studies|investigates|examines|explores|focuses on|works on|develops|uses|employs|researches)\b/i.test(
      cleaned,
    );
  if (hasResearchDescriptionVerb) return false;

  return false;
}

export function isContactRouteDescriptionSnippet(value: unknown): boolean {
  const cleaned = textValue(value);
  if (!cleaned) return false;
  return [
    /^Contact:\s*.+?\bWebsite:\s*https?:\/\//i,
    /^Contact:\s*.+?@.+?\b/i,
    /^Website:\s*https?:\/\/\S+\s+(?:Contact:|We have projects|Students interested)/i,
  ].some((pattern) => pattern.test(cleaned));
}

export function publicResearchEntityDescriptionText(value: unknown): string {
  const cleaned = textValue(value);
  if (
    !cleaned ||
    isContactRouteDescriptionSnippet(cleaned) ||
    isResearchAreaPlaceholderDescription(cleaned) ||
    isAcademicAppointmentDescription(cleaned) ||
    isRoleOnlyTitleFragment(cleaned) ||
    isSyntheticResearchHomeMetadataDescription(cleaned) ||
    isBrokenResearchEntityDescriptionFragment(cleaned) ||
    isMidCvContinuationOpener(cleaned) ||
    isDirectoryIndexChromeText(cleaned) ||
    isSourcePageNarrationDescription(cleaned) ||
    isResearchEntitySourceChromeText(cleaned) ||
    isInstitutionalCenterBlurbText(cleaned)
  ) {
    return '';
  }
  return cleaned;
}

const NON_PERSON_ORG_ENTITY_TYPES = new Set(['CENTER', 'INSTITUTE', 'INITIATIVE', 'CORE_FACILITY']);

export function isNonPersonOrgEntityType(entity?: FacultyResearchTextEntity | null): boolean {
  if (!entity || isFacultyResearchTextEntity(entity)) return false;
  return NON_PERSON_ORG_ENTITY_TYPES.has(String(entity.entityType || '').toUpperCase());
}

const RESEARCHER_VOICE_STUDIES_LEAD_PATTERN = /^Studies\b/i;

export function isResearcherVoiceStudiesLeadOnFundingProgram(
  value: unknown,
  entity?: FacultyResearchTextEntity | null,
): boolean {
  return (
    isProgramLikeResearchEntity(entity as Record<string, unknown> | null | undefined) &&
    RESEARCHER_VOICE_STUDIES_LEAD_PATTERN.test(textValue(value))
  );
}

const ADVISING_MENTEE_NOUN =
  '(?:students?|undergraduates?|undergrads?|grad(?:uate)?\\s+students?|mentees?|advisees?|research\\s+assistants?|trainees?|postdocs?|postdoctoral\\s+(?:fellows?|researchers?)|applicants?)';

const FIRST_PERSON_ADVISING_NOTE_PATTERN = new RegExp(
  `\\bI\\s+(?:only\\s+)?(?:consider|advise|welcome|require|expect|prefer|recruit|mentor|supervise|am\\s+(?:currently\\s+)?(?:recruiting|looking(?:\\s+for)?|accepting|seeking|interested\\s+in))\\b[^.!?]{0,80}?\\b${ADVISING_MENTEE_NOUN}\\b`,
  'i',
);

const FIRST_PERSON_ADVISING_INVITATION_PATTERN = new RegExp(
  `\\bI\\s+would\\s+(?:be\\s+happy|love|be\\s+glad|welcome\\s+the\\s+opportunity)\\s+to\\s+(?:meet|advise|discuss|supervise|mentor|talk|chat|work\\s+with)\\b[^.!?]{0,80}?\\b(?:an?\\s+)?${ADVISING_MENTEE_NOUN}\\b`,
  'i',
);

/**
 * The article before "Professor" is optional: a named/endowed chair reads
 * "is William R. Kenan, Jr. Professor of Black Studies..." with no "the/a"
 * before the donor name (#1745: Daphne Brooks), unlike the plain "is the
 * Sterling Professor of..." shape the mandatory article previously assumed.
 * The donor-name word atom also allows an embedded period so a middle
 * initial or suffix ("R.", "Jr.") does not break the match.
 */
const PERSON_BIOGRAPHY_OPENER_PATTERN =
  /^[A-Z][\p{L}.'’-]+(?:\s+[A-Z][\p{L}.'’-]+){0,3}(?:,\s*(?:PhD|Ph\.D\.?|MD|M\.D\.?|MPH|ScD|Sc\.D\.?|DPhil|JD|MS|MA|MBA|EdD)\b\.?)?\s+is\s+(?:(?:the|an?)\s+)?(?:[\p{L}][\p{L}'’.-]*[\s,/-]+){0,8}Professor\b/u;

const NAME_LEAD_PATTERN = /^[A-Z][\p{L}.'’-]+(?:\s+[A-Z][\p{L}.'’-]+){1,4}\b/u;
const DECEASED_LEAD_DATE_RANGE_PATTERN =
  /\(\s*(?:1[6-9]|20)\d{2}\s*[-–—]\s*(?:1[6-9]|20)\d{2}\s*\)/;
const EMERITUS_APPOINTMENT_PATTERN = /\bEmeritus\b/i;

/**
 * A LAB card's lead already opens on the PI's name and reads "(1932 - 2025),
 * ... Emeritus ..." or otherwise flags the lead as deceased/emeritus within
 * the opening clause (#1638: Demarque Lab spans 1932-2025, Costa Lab is
 * emeritus). `isPersonBiographyOrAdvisingDescription`'s appointment-opener
 * pattern requires a present-tense "is the/an ... Professor" clause and
 * misses this retrospective phrasing entirely, so a deceased/emeritus lead is
 * a distinct, stronger signal: the whole bio reads as a career retrospective,
 * not a single stray opening sentence, so it is never worth salvaging via
 * `repairFacultyBiographyOpener`'s single-sentence strip.
 */
export function isDeceasedOrEmeritusLeadBiography(value: unknown): boolean {
  const cleaned = textValue(value);
  if (!cleaned || !NAME_LEAD_PATTERN.test(cleaned)) return false;
  const opening = cleaned.slice(0, 220);
  return (
    DECEASED_LEAD_DATE_RANGE_PATTERN.test(opening) || EMERITUS_APPOINTMENT_PATTERN.test(opening)
  );
}

const DEGREE_SUFFIX_CLAUSE =
  '(?:,\\s*(?:PhD|Ph\\.D\\.?|MD|M\\.D\\.?|MPH|ScD|Sc\\.D\\.?|DPhil|JD|MS|MA|MBA|EdD)\\b\\.?)*';

/**
 * `PERSON_BIOGRAPHY_OPENER_PATTERN` only recognizes a present-tense "is
 * the/an ... Professor" clause with a capitalized "Professor" - it misses a
 * name-lead opener that names a different title ("is Director of ...", "is a
 * senior lecturer at ...", "is a Fellow of ...") or uses a lowercase
 * "professor" inline (#1638: Kotchen Lab reads "... is the Langdon K. Storm
 * professor of economics ..."; King Lab reads "... is a senior lecturer at
 * ..."; Latham Lab reads "... JD, PhD is Director of ...").
 */
const NAME_LEAD_TITLE_PATTERN = new RegExp(
  `^[A-Z][\\p{L}.'’-]+(?:\\s+[A-Z][\\p{L}.'’-]+){1,4}${DEGREE_SUFFIX_CLAUSE}\\s+is\\s+(?:(?:the|an?)\\s+)?.{0,70}?\\b(?:professor|director|lecturer|fellow|scientist)\\b`,
  'iu',
);

/**
 * A "Dr. <Name>, a graduate of <institution>, is ..." lead, often preceded by
 * a job-title fragment rather than opening directly on the name (#1638:
 * Wisnewski Lab reads "Senior Research Scientist in Medicine ... Dr.
 * Wisnewski, a graduate of the University of California and Brown
 * University's ..., is a widely experienced ..."; Redlich Lab reads "Dr.
 * Redlich, a graduate of Williams College and Yale University School of
 * Medicine, is trained in ..."). Scanned within the opening window rather
 * than anchored at the very start so the leading title fragment doesn't
 * block the match.
 */
const GRADUATE_OF_LEAD_PATTERN =
  /\bDr\.\s+[A-Z][\p{L}.'’-]+(?:\s+[A-Z][\p{L}.'’-]+){0,3},\s+a\s+graduate\s+of\b/iu;

export function isCredentialOrTitleLeadBiography(value: unknown): boolean {
  const cleaned = textValue(value);
  if (!cleaned) return false;
  const opening = cleaned.slice(0, 260);
  return NAME_LEAD_TITLE_PATTERN.test(opening) || GRADUATE_OF_LEAD_PATTERN.test(opening);
}

const DEGREE_ABBREVIATION_ALTERNATION =
  '(?:Ph\\.?D\\.?|M\\.?D\\.?|M\\.?Arch\\.?|B\\.?F\\.?A\\.?|M\\.?F\\.?A\\.?|B\\.?A\\.?|M\\.?A\\.?|B\\.?S\\.?|M\\.?S\\.?|M\\.?B\\.?A\\.?|Ed\\.?D\\.?|J\\.?D\\.?|degrees?)';

/**
 * A leading run of bare "DEGREE, Institution" fragments with no subject or
 * verb at all - not even a "received" clause (#1745 round 4: Kishwar Rizvi's
 * full opens "B.A., Wesleyan University M.Arch., Graduate School of Fine
 * Arts, University of Pennsylvania Ph.D., Massachusetts Institute of
 * Technology" before any prose). Anchored on the tell-tale "DEGREE," opener;
 * the loop-strip's sentence-boundary scan (not this pattern) is responsible
 * for finding where the run-on actually ends.
 */
const LEADING_BARE_DEGREE_LIST_PATTERN = new RegExp(
  `^${DEGREE_ABBREVIATION_ALTERNATION}\\s*,`,
  'u',
);

/**
 * A name-lead opener whose whole sentence is a degree-receipt CV line rather
 * than research prose ("Raffaella Zanuttini received her PhD in Linguistics
 * from..."; "Dr. Mamula's received degrees from UCLA, ..."; "Ms. Feinstein
 * received a B.F.A. from Pratt Institute..."), served verbatim as the
 * description with zero research content (#1745). The determiner before the
 * degree is optional so both "received her PhD" and "received a B.F.A." match.
 */
const DEGREE_RECEIPT_LEAD_PATTERN = new RegExp(
  `^(?:Dr\\.\\s+|Ms\\.\\s+|Mr\\.\\s+|Mrs\\.\\s+)?[A-Z][\\p{L}.'’-]+(?:\\s+[A-Z][\\p{L}.'’-]+){0,3}(?:['’]s)?\\s+received\\s+(?:(?:an?|her|his|their)\\s+)?${DEGREE_ABBREVIATION_ALTERNATION}\\b`,
  'u',
);

/**
 * Common artist/humanities-bio closer clauses that carry no research/practice
 * content of their own (#1745: Rochelle Feinstein's full is entirely CV -
 * degrees, "lives and works in New York City", exhibition history, awards,
 * a residency, upcoming museum surveys, a publications list, and a faculty
 * appointment/emeritus note - with not one sentence describing her actual
 * artistic practice or subject matter).
 */
const LIVES_AND_WORKS_LEAD_PATTERN = /^(?:He|She|They)\s+lives?\s+and\s+works?\s+in\b/iu;

const WORK_EXHIBITED_OR_SHOWN_LEAD_PATTERN =
  /^(?:Her|His|Their)\s+work\s+is\s+(?:exhibited|shown|displayed|performed)\b/iu;

const AMONG_AWARDS_RECEIVED_LEAD_PATTERN = /^Among\s+.{0,40}?\bhas\s+received\b/iu;

const RECENT_PUBLICATIONS_INCLUDE_LEAD_PATTERN = /^Recent\s+publications?\s+include\b/iu;

const APPOINTED_TO_FACULTY_LEAD_PATTERN =
  /^(?:Dr\.\s+|Ms\.\s+|Mr\.\s+|Mrs\.\s+)?[A-Z][\p{L}.'’-]+(?:\s+[A-Z][\p{L}.'’-]+){0,3}\s+was\s+appointed\s+to\s+the\s+.{0,40}?\bfaculty\b/iu;

const ARTIST_IN_RESIDENCE_LEAD_PATTERN =
  /^In\s+\d{4},?\s+(?:he|she|they)\s+was\s+an?\s+(?:artist|scholar|fellow)\s+in\s+residence\b/iu;

const MAJOR_SURVEYS_OF_WORK_LEAD_PATTERN =
  /^(?:He|She|They)\s+(?:will\s+have|has\s+had|had)\s+major\s+surveys?\s+of\s+(?:his|her|their)\s+work\b/iu;

/**
 * A pronoun- or name-lead awards/fellowship credential opener with no
 * research content ("He has received the Best Economics PhD Advisor Award
 * ..."; "Zilibotti is a fellow of the Econometric Society..."), the
 * third-person sibling of the first-person advising note (#1745).
 */
const PRONOUN_CREDENTIAL_LEAD_PATTERN =
  /^(?:He|She|They)\s+(?:has|have)\s+(?:received|earned|been\s+recognized)\b/iu;

/**
 * A first-person appointment/title opener ("I am an Instructor in the
 * Department of Medicine, Section of Infectious Diseases...") that the
 * researcher-voice revoicer converts to third person but that carries no
 * research content on its own - the first-person sibling of
 * `NAME_LEAD_TITLE_PATTERN` (#1745). Requires the title to be anchored to an
 * organizational unit ("in/at/of the Department/Division/..."), not just any
 * self-description containing a title-shaped word, so a genuine specialization
 * lead like "I am a physician-scientist with specialized training in
 * immunology..." is left for the ordinary revoicer rather than blanked (#964).
 */
const FIRST_PERSON_TITLE_LEAD_PATTERN =
  /^I\s+am\s+(?:(?:the|an?)\s+)?[\p{L}\s,/-]{0,40}\b(?:Professor|Instructor|Lecturer|Director|Fellow|Attending)\b\s+(?:in|at|of)\s+the\s+(?:Department|Division|Section|School|Center|Centre|Office|Program)\b/iu;

/**
 * A name-or-pronoun-lead "is a fellow of <Society>" clause and a continued
 * "has (also) received ... awards/honors" clause: the CV/awards run a bio
 * opener leads into often spans several sentences past the opener itself
 * (#1745: Zilibotti's full continues "He has received the Best Economics
 * PhD Advisor Award... Zilibotti is a fellow of the Econometric Society and
 * has received several prestigious awards..." - two more credential
 * sentences after the opener, with no research content of their own).
 */
const FELLOWSHIP_LEAD_PATTERN =
  /^(?:He|She|They|[A-Z][\p{L}.'’-]+(?:\s+[A-Z][\p{L}.'’-]+){0,3})\s+(?:is|was)\s+an?\s+fellow\s+of\b/iu;

const CONTINUED_AWARDS_RECEIPT_PATTERN =
  /^(?:and\s+)?has\s+(?:also\s+)?received\s+(?:several|many|numerous|additional)?\s*(?:prestigious\s+|other\s+)?(?:awards?|honors?|honours?)\b/iu;

/**
 * A "<Name/Title> is the author/winner of <work/prize>" clause: the most
 * common bibliography-style continuation of a person-biography opener
 * (#1745: Daphne Brooks's full continues "She is the author of Bodies in
 * Dissent... winner of..." then "Liner Notes for the Revolution is the
 * winner of eleven book awards and prizes..." - neither sentence names a
 * person via the strict multi-word name-lead patterns above, so a lighter
 * subject requirement is needed here).
 */
const AUTHOR_OR_WINNER_OF_LEAD_PATTERN =
  /^[\p{L}][\p{L}\s.,:'’()-]{0,80}?\s+is\s+the\s+(?:author|winner)\s+of\b/iu;

export function isCredentialOrAwardLeadBiography(value: unknown): boolean {
  const cleaned = textValue(value);
  if (!cleaned) return false;
  return (
    DEGREE_RECEIPT_LEAD_PATTERN.test(cleaned) ||
    PRONOUN_CREDENTIAL_LEAD_PATTERN.test(cleaned) ||
    FIRST_PERSON_TITLE_LEAD_PATTERN.test(cleaned) ||
    FELLOWSHIP_LEAD_PATTERN.test(cleaned) ||
    CONTINUED_AWARDS_RECEIPT_PATTERN.test(cleaned) ||
    AUTHOR_OR_WINNER_OF_LEAD_PATTERN.test(cleaned) ||
    LIVES_AND_WORKS_LEAD_PATTERN.test(cleaned) ||
    WORK_EXHIBITED_OR_SHOWN_LEAD_PATTERN.test(cleaned) ||
    AMONG_AWARDS_RECEIVED_LEAD_PATTERN.test(cleaned) ||
    RECENT_PUBLICATIONS_INCLUDE_LEAD_PATTERN.test(cleaned) ||
    APPOINTED_TO_FACULTY_LEAD_PATTERN.test(cleaned) ||
    ARTIST_IN_RESIDENCE_LEAD_PATTERN.test(cleaned) ||
    MAJOR_SURVEYS_OF_WORK_LEAD_PATTERN.test(cleaned) ||
    LEADING_BARE_DEGREE_LIST_PATTERN.test(cleaned)
  );
}

export function isPersonBiographyOrAdvisingDescription(value: unknown): boolean {
  const cleaned = textValue(value);
  if (!cleaned) return false;

  // Requires a mentee-type noun near the advising verb, not just the verb alone: a bare
  // "I am interested in <research topic>" is the ordinary way faculty state research
  // interests, not a recruiting note, and must not be blanked as one.
  const hasFirstPersonAdvisingNote =
    FIRST_PERSON_ADVISING_NOTE_PATTERN.test(cleaned) ||
    FIRST_PERSON_ADVISING_INVITATION_PATTERN.test(cleaned);
  if (hasFirstPersonAdvisingNote) return true;

  return PERSON_BIOGRAPHY_OPENER_PATTERN.test(cleaned);
}

/**
 * The credential/title-lead and graduate-of fallback patterns were
 * originally tried only for LAB entities (#1638); FACULTY_RESEARCH_AREA and
 * INDIVIDUAL_RESEARCH carry the identical name+appointment-lead shape and are
 * now covered too (#1793).
 */
function firstBiographyOpenerMatch(
  value: string,
  allowCredentialTitlePatterns: boolean,
): RegExpMatchArray | null {
  return (
    value.match(PERSON_BIOGRAPHY_OPENER_PATTERN) ||
    (allowCredentialTitlePatterns
      ? value.match(NAME_LEAD_TITLE_PATTERN) || value.match(GRADUATE_OF_LEAD_PATTERN)
      : null) ||
    value.match(DEGREE_RECEIPT_LEAD_PATTERN) ||
    value.match(PRONOUN_CREDENTIAL_LEAD_PATTERN) ||
    value.match(FIRST_PERSON_TITLE_LEAD_PATTERN) ||
    value.match(FELLOWSHIP_LEAD_PATTERN) ||
    value.match(CONTINUED_AWARDS_RECEIPT_PATTERN) ||
    value.match(AUTHOR_OR_WINNER_OF_LEAD_PATTERN) ||
    value.match(LIVES_AND_WORKS_LEAD_PATTERN) ||
    value.match(WORK_EXHIBITED_OR_SHOWN_LEAD_PATTERN) ||
    value.match(AMONG_AWARDS_RECEIVED_LEAD_PATTERN) ||
    value.match(RECENT_PUBLICATIONS_INCLUDE_LEAD_PATTERN) ||
    value.match(APPOINTED_TO_FACULTY_LEAD_PATTERN) ||
    value.match(ARTIST_IN_RESIDENCE_LEAD_PATTERN) ||
    value.match(MAJOR_SURVEYS_OF_WORK_LEAD_PATTERN) ||
    value.match(LEADING_BARE_DEGREE_LIST_PATTERN)
  );
}

const MAX_BIOGRAPHY_OPENER_SENTENCES_STRIPPED = 8;

/**
 * A CV/credential/awards run served as a description commonly spans several
 * leading sentences, not just the opener (#1745: Zilibotti's opener is
 * followed by a separate awards sentence and a separate fellowship sentence
 * before any research content; Brooks's opener is followed by an
 * author-of/winner-of bibliography run). Each of the biography-opener
 * patterns above is anchored to the start of the string, so re-running the
 * match against the shrinking remainder after every strip finds the next
 * leading CV sentence, if any, until either a non-matching sentence is
 * reached or the text is exhausted.
 */
function stripPersonBiographyOpenerSentence(
  value: string,
  allowCredentialTitlePatterns: boolean,
): string {
  let remaining = value;
  let strippedAny = false;
  for (let iteration = 0; iteration < MAX_BIOGRAPHY_OPENER_SENTENCES_STRIPPED; iteration += 1) {
    const match = firstBiographyOpenerMatch(remaining, allowCredentialTitlePatterns);
    if (!match || match.index === undefined) break;
    const openerEnd = match.index + match[0].length;
    const consumedEnd = sentenceEndIndex(remaining, openerEnd);
    remaining = remaining.slice(consumedEnd).trim();
    strippedAny = true;
    if (!remaining) break;
  }
  return strippedAny ? remaining : value;
}

/**
 * Faculty/individual entities can otherwise have a genuinely good research
 * description that simply opens with a routine appointment sentence ("Elleza
 * Kelley is an Assistant Professor of English..."). Drop only that opening
 * sentence and keep the remainder when it still reads as a research
 * description on its own, instead of blanking the whole field (#1586).
 */
function repairFacultyBiographyOpener(
  value: string,
  allowCredentialTitlePatterns: boolean,
): string {
  const stripped = stripPersonBiographyOpenerSentence(value, allowCredentialTitlePatterns);
  if (!stripped || stripped === value) return '';
  return isLikelyResearchFocusedText(stripped) && !isPersonBiographyOrAdvisingDescription(stripped)
    ? stripped
    : '';
}

const SUBJECTLESS_RESEARCH_LEAD_REPAIRS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^\s*Research\s+examines\b/i, 'Examines'],
  [/^\s*Research\s+investigates\b/i, 'Investigates'],
  [/^\s*Research\s+focuses\s+on\b/i, 'Studies'],
  [/^\s*Research\s+studies\b/i, 'Studies'],
  [/^\s*Research\s+explores\b/i, 'Explores'],
  [/^\s*Focuses\s+on\b/i, 'Studies'],
  [/^\s*Research\s+on\b/i, 'Studies'],
];

export function repairSubjectlessResearchLead(value: unknown): string {
  const text = typeof value === 'string' ? value : '';
  if (!text) return text;
  for (const [pattern, replacement] of SUBJECTLESS_RESEARCH_LEAD_REPAIRS) {
    if (pattern.test(text)) return text.replace(pattern, replacement);
  }
  return text;
}

const GREETING_LEAD_PATTERN = /^welcome to\b/i;

// A period ending a greeting sentence can itself belong to a title
// abbreviation or initial inside the opener ("Welcome to Prof. Xia's lab.",
// "Welcome to Professor Scott A. Strobel's Laboratory."), so the scan below
// only treats "." as a sentence end when it is not immediately preceded by
// one of these; otherwise the greeting is left half-stripped.
//
// Every alternative also allows a period (not just whitespace/paren/start)
// immediately before it, so every period inside a chained-initials or
// multi-segment degree abbreviation ("B.F.A.", "M.F.A.", "M.Arch.", "Ralph J.
// Gleason") is recognized, not just its first segment (#1745/#1790: only the
// first period of "B.F.A." was skipped, so the scan stopped and cut the
// sentence mid-abbreviation; #1745 round 4: "M.Arch." needs the same
// treatment for its second, named segment).
const SENTENCE_BOUNDARY_ABBREVIATION_PATTERN =
  /(?:^|[\s(.])(?:[A-Z]|Prof|Dr|Mr|Mrs|Ms|Jr|Sr|St|Rev|Hon|Arch|Ph|Ph\.?D|M\.?D|B\.?S|M\.?S|M\.?A|D\.?Phil|Esq)\.$/;

function sentenceEndIndex(value: string, from: number): number {
  for (let index = from; index < value.length; index += 1) {
    const char = value[index];
    if (char === '!' || char === '?') return index + 1;
    if (char === '.') {
      const precedingText = value.slice(Math.max(0, index - 14), index + 1);
      if (SENTENCE_BOUNDARY_ABBREVIATION_PATTERN.test(precedingText)) continue;
      return index + 1;
    }
  }
  return value.length;
}

function countWords(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}

function stripLeadingPersonalGreeting(value: string): string {
  if (!GREETING_LEAD_PATTERN.test(value)) return value;
  let cursor = 0;
  while (GREETING_LEAD_PATTERN.test(value.slice(cursor))) {
    const sentenceEnd = sentenceEndIndex(value, cursor);
    if (sentenceEnd <= cursor) break;
    cursor = sentenceEnd;
    while (cursor < value.length && /\s/.test(value[cursor])) cursor += 1;
  }
  const remainder = value.slice(cursor).trim();
  if (countWords(remainder) < 6) return value;
  return remainder;
}

const TRAILING_NAVIGATION_CHROME_PATTERNS: readonly RegExp[] = [
  /[,;]?\s*please click on the links? (?:above|below)\.?\s*$/i,
  /[,;]?\s*please (?:check|visit) the [A-Z][\w' &-]{0,60} section(?: for more information)?(?:,\s*(?:or\s+)?contact\b[^!?]*)?\.?\s*$/i,
  /[,;]?\s*(?:(?:for\s+)?more information\s+)?(?:can be )?found on the [A-Z][\w' &-]{0,60} pages?\.?\s*$/i,
  /[,;]?\s*please contact\b[^!?]*?,?\s*and include in the subject heading\b[^!?]*\.?\s*$/i,
];

const navigationChromeTerminalPunctuationTailPattern = /[.!?]["'’)\]]?$/;
const navigationChromeSentenceEndPattern = /[.!?]["'’)\]]?(?=\s)/g;

function lastCompleteSentenceEnd(value: string): number {
  let end = -1;
  for (const match of value.matchAll(navigationChromeSentenceEndPattern)) {
    end = (match.index ?? 0) + match[0].length;
  }
  return end;
}

/**
 * Every pattern above consumes the clause together with the comma that joined it
 * and the period that ended the sentence, so the surviving prose is left with no
 * terminal punctuation. `isTruncatedCardCopy` reads an unterminated value as a
 * fragment and `shortDescriptionQuality` then flags `incomplete-sentence`, so
 * stripping chrome manufactured the very `missing_public_card_description` the
 * card gate exists to prevent, holding the entity out of every public surface
 * (#2394) - the same defect `clampShortDescriptionToWholeSentences` carries a
 * fix for under #2184.
 *
 * A remainder holding no earlier sentence end is itself one whole sentence, so
 * its period is restored. When an earlier sentence end does exist the remainder
 * is a lead-in to the clause that was just removed ("... For more information
 * and collaborative opportunities"), so it is dropped back to that real boundary
 * rather than terminated: punctuating it would fabricate a plausible-looking
 * sentence out of a fragment. `repairMidSentenceTruncation` cannot be relied on
 * to do this, because it runs earlier in the pipeline than this strip.
 */
function stripTrailingNavigationChromeClause(value: string): string {
  let next = value;
  for (const pattern of TRAILING_NAVIGATION_CHROME_PATTERNS) {
    next = next.replace(pattern, '');
  }
  if (next === value) return value;
  const stripped = next.trim();
  if (!stripped) return stripped;
  if (navigationChromeTerminalPunctuationTailPattern.test(stripped)) return stripped;
  const sentenceEnd = lastCompleteSentenceEnd(stripped);
  if (sentenceEnd < 0) return `${stripped}.`;
  const trimmed = stripped.slice(0, sentenceEnd).trim();
  return countWords(trimmed) >= 6 ? trimmed : `${stripped}.`;
}

const THIRD_PERSON_SINGULAR_PRESENT_VERB_FORMS: Readonly<Record<string, string>> = {
  am: 'is',
  are: 'is',
  have: 'has',
  study: 'studies',
  investigate: 'investigates',
  examine: 'examines',
  explore: 'explores',
  use: 'uses',
  focus: 'focuses',
  develop: 'develops',
  seek: 'seeks',
  aim: 'aims',
  ask: 'asks',
  address: 'addresses',
  analyze: 'analyzes',
  apply: 'applies',
  combine: 'combines',
  build: 'builds',
  model: 'models',
  show: 'shows',
  report: 'reports',
  hypothesize: 'hypothesizes',
  work: 'works',
  research: 'researches',
  lead: 'leads',
  direct: 'directs',
  hold: 'holds',
  teach: 'teaches',
  remain: 'remains',
  run: 'runs',
  serve: 'serves',
  conduct: 'conducts',
  believe: 'believes',
  envision: 'envisions',
  want: 'wants',
  // Measured on the Development corpus for #1871: these are the verbs that
  // actually followed a served body's leading `I`/`We`, and their absence was
  // the whole reason 33 rows kept the source bio's first-person voice. Curated
  // rather than morphological for the reason the alternation is a list at all:
  // a token in the verb slot is only known to be a present-tense verb because
  // it is named here ("I grew up ..." must not become "I grews"). `live` is
  // deliberately absent - its corpus instance is "We live and work in ...",
  // and inflecting only the first verb of a coordination reads worse than
  // leaving the pair alone.
  offer: 'offers',
  provide: 'provides',
  design: 'designs',
  create: 'creates',
  test: 'tests',
  help: 'helps',
  advise: 'advises',
  utilize: 'utilizes',
  specialize: 'specializes',
  strive: 'strives',
  welcome: 'welcomes',
  interpret: 'interprets',
  tend: 'tends',
  care: 'cares',
  do: 'does',
};

const FIRST_PERSON_PAST_OR_MODAL_VERBS = [
  'had',
  'was',
  'would',
  'studied',
  'focused',
  'began',
  'started',
  'joined',
  'received',
  'earned',
  'became',
  'worked',
  'led',
  'directed',
  'held',
  'taught',
  'remained',
  'ran',
  'served',
  'researched',
  'analyzed',
  'applied',
  'combined',
  'built',
  'modeled',
  'showed',
  'reported',
  'hypothesized',
  'used',
  'developed',
  'sought',
  'aimed',
  'asked',
  'addressed',
  'examined',
  'explored',
  'investigated',
  'grew',
];

/**
 * A frequency adverb can sit between the first-person subject and its verb ("I
 * currently focus on ...", "I also serve as ..."), which left the subject
 * unconverted because the verb was no longer adjacent (#1871). Listed rather
 * than matched as "any word" so an unrecognised token still fails the rule
 * closed instead of being conjugated as a verb.
 */
const FIRST_PERSON_SUBJECT_ADVERB_ALTERNATION = [
  'also',
  'currently',
  'primarily',
  'mainly',
  'generally',
  'typically',
  'often',
  'recently',
  'actively',
  'broadly',
  'particularly',
  'especially',
  'now',
].join('|');

const FIRST_PERSON_VERB_ALTERNATION = [
  ...Object.keys(THIRD_PERSON_SINGULAR_PRESENT_VERB_FORMS),
  ...FIRST_PERSON_PAST_OR_MODAL_VERBS,
].join('|');

function conjugateFirstPersonVerbToThirdPersonSingular(verb: string): string {
  return THIRD_PERSON_SINGULAR_PRESENT_VERB_FORMS[verb.toLowerCase()] || verb;
}

// Not a bare present-tense verb, whatever its position: a participle, a past
// form, or an adverb. The corpus carries "We have and ongoing ..." - already
// ungrammatical at the source - and inflecting `ongoing` would serve
// "ongoings".
const NON_BARE_VERB_TOKEN_PATTERN = /(?:ing|ed|ly)$/i;

const SIBILANT_VERB_STEM_PATTERN = /(?:s|x|z|ch|sh|o)$/i;

/**
 * The verb on the far side of an `and` coordination, which the closed
 * alternation cannot enumerate because the coordination can reach any verb in
 * the language ("We develop and harness ...", "I develop and evaluate ...": 10
 * of the corpus's 23 coordinated first-person leads carry a second verb the
 * table does not list).
 *
 * Morphology is safe HERE and nowhere else in this file: the parallel structure
 * guarantees the token is a verb in the same tense as one the table already
 * recognised, so the only question is its inflection, and third-person singular
 * present is mechanical. Returns undefined when the token is not a bare verb at
 * all, which leaves the caller to decline the whole conversion rather than
 * serve a mangled word.
 */
function conjugateCoordinatedVerbToThirdPersonSingular(verb: string): string | undefined {
  const lower = verb.toLowerCase();
  const tabled = THIRD_PERSON_SINGULAR_PRESENT_VERB_FORMS[lower];
  if (tabled) return tabled;
  if (NON_BARE_VERB_TOKEN_PATTERN.test(lower)) return undefined;
  if (/[^aeiou]y$/.test(lower)) return `${verb.slice(0, -1)}ies`;
  return SIBILANT_VERB_STEM_PATTERN.test(lower) ? `${verb}es` : `${verb}s`;
}

/**
 * True when `offset` in `full` sits at the very start of the string or right
 * after a sentence-ending punctuation mark, vs. mid-sentence (e.g. after a
 * clause-introducing comma: "In particular, I am interested..."). The
 * subject-pronoun revoice rules below match `I`/`We` regardless of position
 * (#1745: a residual "I am" mid-sentence survived because the original rules
 * only matched at a sentence boundary), so the replacement's capitalization
 * has to be decided from this rather than baked into the pattern.
 */
function isAtSentenceStart(offset: number, full: string): boolean {
  if (offset === 0) return true;
  const precedingChar = full.slice(0, offset).trimEnd().slice(-1);
  return precedingChar === '' || /[.!?]/.test(precedingChar);
}

const FIRST_PERSON_LEAD_REVOICE_RULES: ReadonlyArray<
  readonly [RegExp, string | ((...args: any[]) => string)]
> = [
  [
    /\bI['’]m\b/g,
    (_match: string, offset: number, full: string) =>
      isAtSentenceStart(offset, full) ? 'This researcher is' : 'this researcher is',
  ],
  [
    /\bI['’]ve\b/g,
    (_match: string, offset: number, full: string) =>
      isAtSentenceStart(offset, full) ? 'This researcher has' : 'this researcher has',
  ],
  // The plural contractions, absent until #1871 measured a served body opening
  // "We're fascinated by ...". Same shape as the two singular rules above.
  [
    /\bWe['’]re\b/g,
    (_match: string, offset: number, full: string) =>
      isAtSentenceStart(offset, full) ? 'This group is' : 'this group is',
  ],
  [
    /\bWe['’]ve\b/g,
    (_match: string, offset: number, full: string) =>
      isAtSentenceStart(offset, full) ? 'This group has' : 'this group has',
  ],
  [
    /(^|[.!?]\s+|,\s+)(?:my|our)\s+careers?\b/gi,
    (_match: string, lead: string, offset: number, full: string) =>
      `${lead}${isAtSentenceStart(offset + lead.length, full) ? 'This' : 'this'} researcher's career`,
  ],
  [
    /(^|[.!?]\s+|,\s+)(?:my|our)\s+group\b/gi,
    (_match: string, lead: string, offset: number, full: string) =>
      `${lead}${isAtSentenceStart(offset + lead.length, full) ? 'This' : 'this'} research group`,
  ],
  [
    new RegExp(
      `\\b(I|We)\\s+(?:(${FIRST_PERSON_SUBJECT_ADVERB_ALTERNATION})\\s+)?(${FIRST_PERSON_VERB_ALTERNATION})\\b(\\s+and\\s+([A-Za-z]+)\\b)?`,
      'g',
    ),
    (
      _match: string,
      subject: string,
      adverb: string | undefined,
      verb: string,
      coordination: string | undefined,
      coordinatedVerb: string | undefined,
      offset: number,
      full: string,
    ) => {
      const conjugatedVerb = conjugateFirstPersonVerbToThirdPersonSingular(verb);
      const conjugatedCoordinatedVerb = coordinatedVerb
        ? conjugateCoordinatedVerbToThirdPersonSingular(coordinatedVerb)
        : undefined;
      const coordinationNeedsAgreement = Boolean(coordination) && conjugatedVerb !== verb;
      if (coordinationNeedsAgreement && !conjugatedCoordinatedVerb) return _match;
      const demonstrative = isAtSentenceStart(offset, full) ? 'This' : 'this';
      const noun = subject === 'We' ? 'group' : 'researcher';
      const adverbPhrase = adverb ? `${adverb} ` : '';
      const coordinatedPhrase = coordinationNeedsAgreement
        ? ` and ${conjugatedCoordinatedVerb}`
        : coordination || '';
      return `${demonstrative} ${noun} ${adverbPhrase}${conjugatedVerb}${coordinatedPhrase}`;
    },
  ],
  /**
   * A possessive lead whose noun phrase is more than one word and is
   * immediately followed by a copula/auxiliary ("My research interests
   * are...", "Our career goals have been...") needs the demonstrative's
   * number to agree with the phrase's actual head noun (its LAST word,
   * matching the copula that already follows it), not the single word the
   * generic catch-all below would grab first (#1806: "My research
   * interests are" was becoming "This research interests are" - "This"
   * agreeing with "research", a word the sentence's own verb never agreed
   * with in the first place).
   */
  [
    /(^|[.!?]\s+|,\s+)(?:my|our)\s+((?:[A-Za-z]+\s+){0,4}?[A-Za-z]+)(?=\s+(?:is|are|was|were|has|have)\b)/gi,
    (_match: string, lead: string, phrase: string, offset: number, full: string) => {
      const words = phrase.trim().split(/\s+/);
      const headNoun = words[words.length - 1];
      const atSentenceStart = isAtSentenceStart(offset + lead.length, full);
      return `${lead}${pluralAwareDemonstrative(headNoun, atSentenceStart)} ${phrase}`;
    },
  ],
];

const ABSTRACT_SINGULAR_ANTECEDENT_NOUN_PATTERN =
  /(^|[.!?]\s+)(?:My|Our)\s+((?:\w+\s+)?(?:goal|mission|focus|vision|approach))\b/gi;

const NAME_ENDING_IN_AFFILIATION_PHRASE_PATTERN = /\s+at\s+\S/i;

/**
 * A bare demonstrative ("This goal is...", "This mission is...") dangles for
 * these abstract singular nouns: there is no preceding antecedent sentence
 * for "this" to point back to, so the student reads a non-sequitur. An
 * entity-possessive subject ("The Foxman Lab's goal is...") reads correctly
 * with no antecedent required.
 *
 * A name carrying an affiliation phrase is the exception: "<X> Lab at Yale's
 * research" attaches the possessive to the place rather than to the lab, so such
 * a name falls back to the generic demonstrative possessive.
 */
function possessiveLeadSubject(entity?: FacultyResearchTextEntity | null): string {
  const baseName = entity ? facultyResearchLabelBase(entity) : '';
  if (baseName && !NAME_ENDING_IN_AFFILIATION_PHRASE_PATTERN.test(baseName)) {
    return possessiveName(baseName);
  }
  if (isLabResearchTextEntity(entity)) return "This lab's";
  if (isFacultyResearchTextEntity(entity)) return "This researcher's";
  return "This research group's";
}

const SINGULAR_NOUN_S_ENDING_EXCEPTIONS = /(?:ss|us|is|ics)$/i;

function pluralAwareDemonstrative(noun: string, capitalized: boolean): string {
  const isPlural = /s$/i.test(noun) && !SINGULAR_NOUN_S_ENDING_EXCEPTIONS.test(noun);
  const word = isPlural ? 'these' : 'this';
  return capitalized ? `${word[0].toUpperCase()}${word.slice(1)}` : word;
}

const GENERIC_POSSESSIVE_LEAD_PATTERN = /(^|[.!?]\s+|,\s+)(?:my|our)\s+(\w+)\b/gi;

const CONVERTED_FIRST_PERSON_SUBJECT_PATTERN = /\bthis (?:researcher|group)\b/i;

/**
 * A converted subject ("I received" -> "This researcher received") can leave
 * a same-sentence possessive referring to that same subject unconverted
 * ("This researcher received my PhD..."), since the possessive itself never
 * matched any I/We rule (#1824). Scoped to the current sentence only, so a
 * genuinely third-person sentence with an unrelated "our"/"my" (e.g. "This
 * work advances our understanding...") is left untouched.
 */
function sentenceHasConvertedFirstPersonSubject(offset: number, full: string): boolean {
  const beforeMatch = full.slice(0, offset);
  const boundaryPattern = /[.!?]\s+/g;
  let sentenceStart = 0;
  let boundary: RegExpExecArray | null;
  while ((boundary = boundaryPattern.exec(beforeMatch))) {
    sentenceStart = boundary.index + boundary[0].length;
  }
  return CONVERTED_FIRST_PERSON_SUBJECT_PATTERN.test(beforeMatch.slice(sentenceStart));
}

/**
 * A directly quoted span, straight or curly. Single quotes are deliberately absent:
 * an apostrophe is indistinguishable from a closing single quote in this corpus, so
 * pairing them would swallow the rest of a body after any possessive.
 */
const DIRECTLY_QUOTED_SPAN_PATTERN = /"[^"]*"|“[^”]*”/g;

const directlyQuotedRanges = (text: string): ReadonlyArray<readonly [number, number]> => {
  const ranges: Array<readonly [number, number]> = [];
  for (const match of text.matchAll(DIRECTLY_QUOTED_SPAN_PATTERN)) {
    if (typeof match.index === 'number') ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
};

const overlapsDirectQuotation = (
  ranges: ReadonlyArray<readonly [number, number]>,
  offset: number,
  length: number,
): boolean => ranges.some(([start, end]) => offset < end && offset + length > start);

/**
 * Runs one revoice pass, refusing any match that falls inside a direct quotation.
 *
 * The guard is a refusal rather than a rewrite because the two cases differ in kind:
 * placeholder copy outside quotation marks is an honest paraphrase, while inside them
 * the page asserts these were the person's words, so transforming it serves a
 * quotation no source contained and attributes it to a named person (#2974).
 *
 * Ranges are recomputed per pass and never hoisted out of this helper. A `replace`
 * callback receives offsets into the string as it was BEFORE that pass, so ranges
 * computed immediately before each pass are exact, while one set reused across passes
 * would drift as earlier passes changed the string's length.
 */
const revoicePassOutsideQuotations = (
  text: string,
  pattern: RegExp,
  replacement: string | ((...args: any[]) => string),
): string => {
  const ranges = directlyQuotedRanges(text);
  if (!ranges.length) return text.replace(pattern, replacement as any);
  return text.replace(pattern, (...args: any[]) => {
    const match = args[0] as string;
    const offset = args[args.length - 2] as number;
    if (overlapsDirectQuotation(ranges, offset, match.length)) return match;
    return typeof replacement === 'function' ? replacement(...args) : replacement;
  });
};

export function revoiceFirstPersonResearchLead(
  value: unknown,
  entity?: FacultyResearchTextEntity | null,
): string {
  const text = typeof value === 'string' ? value : '';
  if (!text) return text;
  let next = stripLeadingPersonalGreeting(text);
  const possessiveSubject = possessiveLeadSubject(entity);
  next = revoicePassOutsideQuotations(
    next,
    ABSTRACT_SINGULAR_ANTECEDENT_NOUN_PATTERN,
    (_match: string, lead: string, nounPhrase: string) =>
      `${lead}${possessiveSubject} ${nounPhrase}`,
  );
  for (const [pattern, replacement] of FIRST_PERSON_LEAD_REVOICE_RULES) {
    next = revoicePassOutsideQuotations(next, pattern, replacement);
  }
  next = revoicePassOutsideQuotations(
    next,
    GENERIC_POSSESSIVE_LEAD_PATTERN,
    (_match: string, lead: string, noun: string, offset: number, full: string) => {
      const atSentenceStart = isAtSentenceStart(offset + lead.length, full);
      return `${lead}${pluralAwareDemonstrative(noun, atSentenceStart)} ${noun}`;
    },
  );
  next = revoicePassOutsideQuotations(
    next,
    /\b(?:my|our)\b/gi,
    (match: string, offset: number, full: string) =>
      sentenceHasConvertedFirstPersonSubject(offset, full) ? 'their' : match,
  );
  return next;
}

const ORPHANED_THIRD_PERSON_POSSESSIVE_LEAD_PATTERN = /^(?:His|Her|Their)\s+(?=[a-z])/;

const ORPHANED_THIRD_PERSON_SUBJECT_LEAD_PATTERN = /^(?:He|She)\s+(?=[a-z])/;

/**
 * A body whose FIRST word is a third-person pronoun carried over from the
 * scraped bio's grammatical subject ("His research focuses on ...", "Her recent
 * publications include ...", "She holds a joint appointment ...") (#1871).
 * Nothing precedes it, so the pronoun has no antecedent in the prose, and on an
 * impersonally named entity - an acronym lab, a facility - the page shows no
 * person for it to resolve to either.
 *
 * Only the LEADING pronoun is revoiced. A later one can point back at a subject
 * the prose itself introduced, and rewriting those would replace working
 * references with repetition; resolving the leading one also gives the rest of
 * the body the antecedent it was missing.
 *
 * The possessive determiner is replaced with the entity-derived possessive
 * subject `my`/`our` already resolve to (#1829), which keeps the noun phrase
 * after it verbatim: substituting a demonstrative instead would have to agree
 * with that phrase's head noun, and guessing the head wrongly produced "This
 * research interests include ...". The subject comes from the entity's own name
 * rather than a roster join because the page already carries that name as its
 * heading, so restating it asserts nothing new - whereas the harvested prose
 * carries no evidence that its subject is the resolved lead.
 *
 * A possessed research-home noun ("His lab studies ...") needs no branch of its
 * own: the possessive rule reads "<Entity>'s lab studies ...", which is what the
 * entity's own name is for. A demonstrative branch for that shape looked
 * tempting and is a trap, because the noun it matches is as often a MODIFIER as
 * a head ("His lab members are ..." -> "This lab members are ..."), and on the
 * corpus it fires on no row at all: every row whose body opens on a possessive
 * pronoun has a name to possess.
 *
 * `He`/`She` takes a singular noun subject, leaving the verb's agreement alone;
 * `They` is deliberately absent for the opposite reason. It stays a
 * demonstrative because a personal pronoun refers to a person whatever the
 * entity is, and an organizational name in that slot would claim the
 * organization holds the appointment or earned the degree.
 *
 * The lowercase lookahead keeps a proper noun out of both rules ("He Wang
 * studies ..." is a surname, not a pronoun), so a capitalized opener is left
 * alone rather than guessed at.
 */
export function revoiceOrphanedThirdPersonLead(
  value: unknown,
  entity?: FacultyResearchTextEntity | null,
): string {
  const text = typeof value === 'string' ? value : '';
  if (!text) return text;
  if (ORPHANED_THIRD_PERSON_POSSESSIVE_LEAD_PATTERN.test(text)) {
    return text.replace(
      ORPHANED_THIRD_PERSON_POSSESSIVE_LEAD_PATTERN,
      `${possessiveLeadSubject(entity)} `,
    );
  }
  return text.replace(ORPHANED_THIRD_PERSON_SUBJECT_LEAD_PATTERN, 'This researcher ');
}

export interface BiographyOrDeceasedEmeritusLeadRepair {
  changed: boolean;
  value: string;
}

/**
 * The single guard-and-repair decision shared by every description/summary
 * field: does this field's text open on a person-biography/advising note or a
 * deceased/emeritus lead, and if so, is it salvageable by stripping just the
 * opener (faculty/lab entities) or does it need to be blanked outright (a
 * non-person org, or a deceased/emeritus lead whose whole bio reads as a
 * retrospective rather than one stray sentence)? Exported standalone so a
 * one-time backfill can apply exactly this decision to already-stored text
 * without also re-running the unrelated first-person-revoice/subjectless-lead
 * repairs that the rest of `sanitizeResearchEntityPublicDescriptionFields`
 * performs on every read (#1638).
 */
export function repairBiographyOrDeceasedEmeritusLead(
  value: unknown,
  entity: FacultyResearchTextEntity,
): BiographyOrDeceasedEmeritusLeadRepair {
  const text = typeof value === 'string' ? value : '';
  const rejectPersonBiography = isNonPersonOrgEntityType(entity);
  const isLabEntity = isLabResearchTextEntity(entity);
  const isFacultyEntity = isFacultyResearchTextEntity(entity);
  const shouldGuard = rejectPersonBiography || isFacultyEntity || isLabEntity;
  const deceasedOrEmeritusLead = isLabEntity && isDeceasedOrEmeritusLeadBiography(text);
  const credentialLead = (isLabEntity || isFacultyEntity) && isCredentialOrTitleLeadBiography(text);
  const credentialOrAwardLead = shouldGuard && isCredentialOrAwardLeadBiography(text);
  if (
    !shouldGuard ||
    !(
      isPersonBiographyOrAdvisingDescription(text) ||
      deceasedOrEmeritusLead ||
      credentialLead ||
      credentialOrAwardLead
    )
  ) {
    return { changed: false, value: text };
  }
  const repaired = deceasedOrEmeritusLead
    ? ''
    : isFacultyEntity || isLabEntity
      ? repairFacultyBiographyOpener(text, isLabEntity || isFacultyEntity)
      : '';
  return { changed: repaired !== text, value: repaired };
}

/**
 * `shortDescription` is excluded from both revoice passes for the same reason:
 * the card path fails an orphaned-pronoun opener closed and re-derives a card
 * from the body, which is a better card than a revoiced fragment. Revoicing the
 * body is what makes that re-derivation usable.
 */
const revoicedFirstPersonBody = (
  value: string,
  entity: FacultyResearchTextEntity,
  field: string,
): string => (field === 'shortDescription' ? value : revoiceFirstPersonResearchLead(value, entity));

/**
 * Runs LAST in the per-field chain so the mismatched-person-name correction and
 * the fail-closed gate ahead of it judge the harvested prose rather than the
 * possessive subject this substitutes. Reversing the order let a synthesized
 * "<Entity name>'s honors include ..." be read as a mismatched name prefix and
 * blanked, which would have cost the row its whole body.
 *
 * Ordering alone is not enough, because `sanitizeFacultyResearchEntityCopyFields`
 * runs that same correction downstream of this one: `namesEntityItself` is what
 * keeps it from blanking the subject substituted here.
 */
const revoicedThirdPersonBody = (
  value: string,
  entity: FacultyResearchTextEntity,
  field: string,
): string => (field === 'shortDescription' ? value : revoiceOrphanedThirdPersonLead(value, entity));

const CREDENTIAL_RUN_HONORIFIC = '(?:Dr|Drs|Prof|Professor|Mr|Ms|Mrs)\\.?\\s+';

/**
 * The credential a leading run has to name for the run to read as an appointment
 * or credential list rather than as prose. An endowed-chair donor name, a hospital
 * name and a departmental unit are all unbounded vocabularies, so the run is
 * recognised by the one word in it that is not: the post, the degree, or the
 * "graduate of" clause that opens a degree list.
 */
const CREDENTIAL_RUN_DEGREE_TOKEN =
  '(?:A\\.?B|B\\.?A|B\\.?S|B\\.?Sc|B\\.?D|B\\.?F\\.?A|M\\.?A|M\\.?S|M\\.?Sc|M\\.?D|M\\.?Div|M\\.?L\\.?S|M\\.?P\\.?H|M\\.?Phil|M\\.?B\\.?A|M\\.?A\\.?T|M\\.?Arch|M\\.?H\\.?S|Ph\\.?D|Sc\\.?D|J\\.?D|Ed\\.?D|D\\.?Min|D\\.?V\\.?M|R\\.?N|FAAN|FACP)';

const credentialRunPostPattern = new RegExp(
  '\\b(?:Professors?|Prof|Lecturers?|Instructors?|Directors?|Chiefs?|Chair(?:s|man|woman)?|Deans?|Heads?|Officers?|Scientists?|Fellows?|Curators?|Liaisons?|Affiliates?|Attendings?|Faculty|Appointments?)\\b' +
    '|\\bgraduate\\s+of\\b' +
    `|\\b${CREDENTIAL_RUN_DEGREE_TOKEN}\\.?(?=[\\s,;.]|$)`,
);

// The credential has to be named EARLY. A window wide enough to reach the end of a
// long noun phrase also reaches past a narrative opener into a title it mentions in
// passing, which read "Under the leadership of Dr. <name>, the Section Chief of
// Neurosurgical Oncology ..." as a title run and dropped it.
const CREDENTIAL_RUN_POST_WINDOW_WORDS = 5;

// A run shorter than this is the prose's own subject phrase ("Professor" ahead of
// "<surname> studies ..."), not a title block prepended to it.
const MIN_CREDENTIAL_RUN_LENGTH = 24;
const MIN_CREDENTIAL_RUN_WORDS = 4;
const MAX_CREDENTIAL_RUN_LENGTH = 600;
const MIN_SURVIVING_NARRATIVE_LENGTH = 60;

/**
 * A finite verb. A run carrying one is a clause, so it is prose whatever else it
 * looks like, and the same list decides that the text left behind is prose rather
 * than more of the list. Both sides read the one list deliberately: a verb the
 * survivor test accepted and the run test did not made the strip non-idempotent,
 * because the survivor's own first sentence then read as a droppable run.
 */
const CREDENTIAL_RUN_FINITE_VERB =
  '(?:is|am|are|was|were|has|have|had|include|includes|involves?|spans?|lies?|centers?|centres?|concerns?|joined|became|received|obtained|studies|grew|worked|works|serves|served|directs|directed|leads|led|teaches|taught|focuses|focused|graduated|earned|completed|holds|held|conducts|investigates|examines|explores|develops|specializes|practices|oversees|curated|developed|participated|returned|aims|seeks|uses|employs)';

/**
 * The same verbs contracted onto their subject. A word boundary never falls inside
 * "I'm", so a first-person self-description read as a verb-less title run and the
 * strip deleted the sentence: "I'm an Associate Professor in the Department of
 * Linguistics, director of the Phonetics Laboratory, and Associate Editor of
 * Laboratory Phonology" left only the affiliation sentence behind it, which then
 * passed the quality bar the unstripped body had correctly failed.
 */
const CREDENTIAL_RUN_CONTRACTED_FINITE_VERB =
  "(?:I['’]m|(?:he|she|it|that|there|who|what)['’]s|(?:we|you|they)['’]re|(?:I|we|you|they)['’]ve|(?:I|we|you|they|he|she|it)['’]d)";

const credentialRunFiniteVerbPattern = new RegExp(
  `\\b${CREDENTIAL_RUN_FINITE_VERB}\\b|\\b${CREDENTIAL_RUN_CONTRACTED_FINITE_VERB}`,
  'i',
);

/**
 * A lower-case participle or gerund, which no title or degree run contains and
 * which a descriptive clause that merely opens on a post does ("Professor of
 * Chemistry, developing new catalysts, ..."). It is the guard that stops the
 * no-finite-verb test from reading a verb-less clause of real content as chrome,
 * and it is lower-case-only because a title run is full of capitalised ones
 * ("Engineering", "Outreach", "Retired National Director").
 */
const credentialRunProseParticiplePattern = /\b[a-z]{3,}(?:ing|ed)\b/;

/**
 * A word that may precede the post inside a title run: a capitalised word, a year,
 * a bare degree token, or one of the function words a title itself contains. A
 * lower-case content word there means the post is being mentioned by a clause
 * rather than listed, which is what kept "The research in Professor <surname>'s
 * research program ..." from being read as a title block.
 */
const credentialRunPrefixWordPattern = new RegExp(
  `^(?:[\\p{Lu}\\d(]|&|-|${CREDENTIAL_RUN_DEGREE_TOKEN}\\b|(?:of|for|in|on|at|and|the|a|an|to|with|de|von|van)$)`,
  'u',
);

/**
 * A run that opens by naming the subject. A title block never does, so this is what
 * separates a prepended title list from the person's own opening sentence: without
 * it "Professor <surname>'s research interests include human resources; ..." and
 * "Dr. <name> PhD, RN, FAAN is the ... Professor of Nursing ..." were both read as
 * chrome, dropping the row's only research sentence in the first case and the
 * subject's own name in the second.
 */
const credentialRunNameLeadPattern = new RegExp(
  `^(?:${CREDENTIAL_RUN_HONORIFIC}` +
    `|[A-Z][\\p{L}'’‘-]+(?:\\s+[A-Z][\\p{L}.'’‘-]*){0,3},?\\s+${CREDENTIAL_RUN_DEGREE_TOKEN}\\.?[\\s,;])`,
  'u',
);

const escapeForRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Where a narrative clause can begin without the subject's name being known: an
 * honorific naming the subject, a determiner or pronoun followed by a lower-case
 * word, or a sentence-initial adverbial or third-person verb. The following
 * lower-case word is what separates a determiner clause opener from a title list's
 * own capitalised words ("Director of The Anlyan Center"), and no bare lower-case
 * token may anchor a seam because a title list is full of them ("Water Policy and
 * Management").
 *
 * "Professor" is an honorific here only when the word after it is not one of a
 * title's own qualifiers, because "Full Professor Emeritus of the University of
 * Athens" would otherwise seam inside the run.
 */
const CREDENTIAL_RUN_NARRATIVE_SEAM_PATTERNS: readonly RegExp[] = [
  /(?:^|[\s.;])(?:Dr|Drs|Prof|Mr|Ms|Mrs)\.?\s+[A-Z]/g,
  /(?:^|[\s.;])Professor\s+(?!Emeritus\b|Emerita\b|Adjunct\b|Associate\b|Assistant\b|Clinical\b|Visiting\b|Senior\b|Primary\b)[A-Z]/g,
  /(?:^|[\s.;])(?:An?|The|This|These|His|Her|Their|My|Our|Its|He|She|They|We|I)\s+[a-z]/g,
  /(?:^|[\s.;])(?:[Tt]his|[Tt]hese|[Oo]ur|[Ww]e|[Mm]y)\s+[a-z]/g,
  /(?:^|[.;]\s)(?:After|Before|Prior|Throughout|During|Since|Following|Currently|Recently|Originally|Initially|Conducts|Studies|Researches|Investigates|Examines|Explores|Develops|Focuses|Specializes)\s+[a-z]/g,
];

/**
 * Where the subject's own name begins, built from the names the record already
 * knows: its own person-scoped label and its roster-resolved leads.
 *
 * The name is evidence rather than a guess, and it is the only thing that can place
 * this seam. A pattern that recognises "a capitalised run followed by a verb"
 * cannot tell the name from the title run's own trailing words, because a title run
 * ends in capitalised words by nature: it seams at "Art" in "... History of Art
 * <given> <surname>, ..., became dean", at "Union" in "... Graduate Theological
 * Union <given> <initial> <surname> has served ...", and at "UCLA" in "... Ph.D.,
 * UCLA <given> <surname> completed ...", serving the title's own tail as the first
 * word of the body. Taking the last token of the name and walking left is no better,
 * since that drops the given name.
 */
function subjectNameSeamPatterns(subjectNames: readonly string[]): RegExp[] {
  const patterns: RegExp[] = [];
  const seen = new Set<string>();
  for (const subjectName of subjectNames) {
    const parts = personNameParts(subjectName);
    if (!parts) continue;
    const surname = escapeForRegExp(parts.surname);
    const given = parts.givenNames.length ? escapeForRegExp(parts.givenNames[0]) : '';
    const key = `${given}|${surname}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (given) {
      patterns.push(
        new RegExp(
          `(?:^|[\\s.;])(?:${CREDENTIAL_RUN_HONORIFIC})?${given}` +
            `(?:\\s+[A-Z][\\p{L}.'’‘-]*){0,3}\\s+${surname}\\b`,
          'giu',
        ),
      );
      patterns.push(new RegExp(`(?:^|[\\s.;])${given}['’]s\\s+[a-z]`, 'giu'));
    }
    patterns.push(
      new RegExp(`(?:^|[\\s.;])(?:${CREDENTIAL_RUN_HONORIFIC})?${surname}['’]s\\s+[a-z]`, 'giu'),
    );
  }
  return patterns;
}

const credentialRunSeamOffsets = (value: string, subjectNames: readonly string[]): number[] => {
  const offsets = new Set<number>();
  for (const pattern of [
    ...CREDENTIAL_RUN_NARRATIVE_SEAM_PATTERNS,
    ...subjectNameSeamPatterns(subjectNames),
  ]) {
    pattern.lastIndex = 0;
    for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
      offsets.add(match.index + (/^[\s.;]/.test(match[0]) ? 1 : 0));
      pattern.lastIndex = match.index + 1;
    }
  }
  return Array.from(offsets).sort((left, right) => left - right);
};

/**
 * Whether the run ahead of a seam reads as a bare appointment or credential list:
 * it names a post or a degree early, every word ahead of that post belongs in a
 * title, it carries no finite verb and no lower-case participle of its own, it does
 * not open by naming the subject, and it is short enough to be a page's title block
 * rather than its content.
 */
function isBareCredentialTitleRun(run: string): boolean {
  if (run.length < MIN_CREDENTIAL_RUN_LENGTH || run.length > MAX_CREDENTIAL_RUN_LENGTH)
    return false;
  const words = run.split(/\s+/).filter(Boolean);
  if (words.length < MIN_CREDENTIAL_RUN_WORDS) return false;
  if (credentialRunFiniteVerbPattern.test(run)) return false;
  if (credentialRunProseParticiplePattern.test(run)) return false;
  if (credentialRunNameLeadPattern.test(run)) return false;
  const window = words.slice(0, CREDENTIAL_RUN_POST_WINDOW_WORDS);
  const postIndex = window.findIndex((word) => credentialRunPostPattern.test(word));
  if (postIndex < 0 && !credentialRunPostPattern.test(window.join(' '))) return false;
  const prefix = postIndex < 0 ? window : window.slice(0, postIndex);
  return prefix.every((word) => credentialRunPrefixWordPattern.test(word));
}

/**
 * Drop a leading appointment or credential run that a whole-block DOM extraction
 * glued onto the following narrative with no delimiter, so the served body opens on
 * the research rather than on a title list, a directorship run or a degree list
 * (#2973).
 *
 * The glue is not in the source page: each title and the bio are separate
 * paragraphs, and the flattening step collapses a paragraph break to a single space
 * by design (#851, so a proper noun is never split on casing). The cost is that the
 * run and the first real sentence become one segment, so every sentence-bounded
 * lead strip either deletes the good sentence with the chrome or declines.
 * `stripLeadingAppointmentTitleBlock` (#1815) recovers the boundary where the
 * narrative resumes on a pronoun or an honorific; this recovers it where the
 * narrative resumes on the subject's own name, which needs the record's own names
 * and so cannot live beside that one.
 *
 * Fails closed - returns the text unchanged - unless the dropped run reads as a bare
 * credential list and a substantial narrative carrying a verb survives, so a
 * credential-only description is left to the closers that already fail it
 * (`isRoleOnlyTitleFragment`, `isAcademicAppointmentDescription`,
 * `isCredentialOrAwardLeadBiography`) rather than truncated to a fragment here.
 */
export function stripLeadingCredentialTitleRun(
  value: unknown,
  subjectNames: readonly string[] = [],
): string {
  const text = textValue(value);
  if (!text) return typeof value === 'string' ? value : '';
  for (const seam of credentialRunSeamOffsets(text, subjectNames)) {
    if (seam <= 0 || seam > MAX_CREDENTIAL_RUN_LENGTH) continue;
    if (!isBareCredentialTitleRun(text.slice(0, seam).trim())) continue;
    const narrative = text.slice(seam).trim();
    if (
      narrative.length < MIN_SURVIVING_NARRATIVE_LENGTH ||
      !credentialRunFiniteVerbPattern.test(narrative)
    ) {
      continue;
    }
    return narrative.charAt(0).toUpperCase() + narrative.slice(1);
  }
  return text;
}

/**
 * The sentence the chain will lead with once the credential run is gone. The strip
 * runs ahead of the biography repair so that pass sees the real opener, which means
 * the sentence a reader actually meets is the one the biography repair promotes, not
 * the one the strip uncovers.
 */
function openerTheChainWouldLeadWith(uncovered: string, entity: FacultyResearchTextEntity): string {
  const biographyRepair = repairBiographyOrDeceasedEmeritusLead(uncovered, entity);
  const promoted = biographyRepair.changed ? biographyRepair.value : uncovered;
  const [openingSentence = ''] = splitDescriptionSentences(promoted);
  return openingSentence;
}

/**
 * Whether dropping the credential run trades a title list for a career fact.
 *
 * Nothing else in the chain judges the sentence the biography repair promotes to
 * first position, so on a body whose credential run hid a career timeline the strip
 * replaced "Emeritus Professor of Surgery ... Editor-in-Chief, Journal of ..." with
 * "trained at three universities before an appointment to the faculty in 2001" and
 * every quality detector reported the result clean - the defect the strip exists to
 * remove, one sentence further in (#2973). Withdrawing the strip leaves the body to
 * the closers that already fail a credential lead closed rather than promoting a
 * worse opener than the one it removed.
 */
function credentialRunStripPromotesACareerFact(
  uncovered: string,
  entity: FacultyResearchTextEntity,
): boolean {
  return isCareerFactSentence(openerTheChainWouldLeadWith(uncovered, entity));
}

/**
 * The names the record itself vouches for as its subject: its own person-scoped
 * label and its roster-resolved leads. An organization-shaped record has no person
 * subject, and its name is an organization's, so it contributes none.
 */
export function researchEntitySubjectPersonNames(
  entity: Record<string, any>,
  leadMemberNames: readonly string[] = [],
): string[] {
  const names = [...leadMemberNames];
  if (isPersonScopedResearchEntity(entity)) {
    const baseName = facultyResearchLabelBase(entity as FacultyResearchTextEntity);
    if (baseName) names.push(baseName);
  }
  return Array.from(new Set(names.map(textValue).filter(Boolean)));
}

export function sanitizeResearchEntityPublicDescriptionFields<T extends Record<string, any>>(
  entity: T,
  leadMemberNames: readonly string[] = [],
): T {
  let changed = false;
  const next: Record<string, any> = { ...entity };
  const subjectNames = researchEntitySubjectPersonNames(next, leadMemberNames);

  for (const field of DESCRIPTION_AND_SYNTHESIS_FIELDS) {
    if (field in next) {
      if (typeof next[field] !== 'string') continue;
      // Ahead of every other repair in the chain, because a leading credential run
      // hides the body's real opener from all of them: the biography repair, the
      // revoice passes and the orphaned-pronoun pass all read the first sentence,
      // and a run glued to it makes that sentence the title list. Running first also
      // means the revoice passes repair any pronoun lead this uncovers.
      if ((HYGIENE_FULL_DESCRIPTION_FIELDS as readonly string[]).includes(field)) {
        const withoutCredentialRun = stripLeadingCredentialTitleRun(next[field], subjectNames);
        if (
          withoutCredentialRun !== next[field] &&
          !credentialRunStripPromotesACareerFact(withoutCredentialRun, next)
        ) {
          next[field] = withoutCredentialRun;
          changed = true;
        }
      }
      const biographyRepair = repairBiographyOrDeceasedEmeritusLead(next[field], next);
      if (biographyRepair.changed) {
        // Stripping the biography opener is what leaves the NEXT sentence's
        // pronoun heading the body ("... is a senior lecturer. His research
        // focuses on ..." -> "His research focuses on ..."), so the revoice pass
        // has to run on the remainder. Returning early past it left the served
        // body in the source bio's voice on rows whose stored text never opened
        // with a pronoun at all, which is where most of #1871's rows came from.
        next[field] = revoicedThirdPersonBody(
          revoicedFirstPersonBody(biographyRepair.value, next, field),
          next,
          field,
        );
        changed = true;
        continue;
      }
      const withNavigationChromeStripped = stripTrailingNavigationChromeClause(next[field]);
      const withResearchLeadRepair = repairSubjectlessResearchLead(withNavigationChromeStripped);
      const withFirstPersonReVoice = revoicedFirstPersonBody(withResearchLeadRepair, next, field);
      const withLeadNameCorrection = sanitizeLeadingMismatchedPersonNamePrefix(
        withFirstPersonReVoice,
        leadMemberNames,
        next,
      );
      const withLeadNameCorrectionIfResearch = guardNonResearchProfileSynthesisText(
        withLeadNameCorrection,
        next,
        field,
      );
      const withFundingProgramStudiesGuard =
        field === 'shortDescription' &&
        isResearcherVoiceStudiesLeadOnFundingProgram(withLeadNameCorrectionIfResearch, next)
          ? ''
          : withLeadNameCorrectionIfResearch;
      const cleaned = revoicedThirdPersonBody(
        publicResearchEntityDescriptionText(withFundingProgramStudiesGuard),
        next,
        field,
      );
      if (cleaned !== next[field]) {
        next[field] = cleaned;
        changed = true;
      }
    }
  }

  if ('summary' in next) {
    const summaryBiographyRepair = repairBiographyOrDeceasedEmeritusLead(next.summary, next);
    const guardedSummary = summaryBiographyRepair.changed
      ? summaryBiographyRepair.value
      : next.summary;
    const cleaned = publicResearchEntityDescriptionText(guardedSummary);
    if (cleaned !== next.summary) {
      next.summary = cleaned;
      changed = true;
    }
  }

  return changed ? (next as T) : entity;
}

export function isFacultyResearchTextEntity(entity?: FacultyResearchTextEntity | null): boolean {
  return Boolean(
    entity &&
    (entity.kind === 'individual' ||
      entity.kind === 'solo' ||
      entity.entityType === 'FACULTY_RESEARCH_AREA' ||
      entity.entityType === 'INDIVIDUAL_RESEARCH'),
  );
}

export function isLabResearchTextEntity(entity?: FacultyResearchTextEntity | null): boolean {
  return Boolean(entity && (entity.kind === 'lab' || entity.entityType === 'LAB'));
}

export function stripFacultyResearchAreaNameTemplateSuffix(name: unknown): string {
  return textValue(name)
    .replace(/\s*[-–—]\s*Research$/i, '')
    .replace(/\s+(?:Faculty Research|Lab|Laboratory|Research)$/i, '')
    .trim();
}

function facultyResearchLabelBase(entity: FacultyResearchTextEntity): string {
  return stripFacultyResearchAreaNameTemplateSuffix(entity.displayName || entity.name);
}

function possessiveName(name: string): string {
  return name.endsWith('s') ? `${name}'` : `${name}'s`;
}

const DOUBLED_RESEARCH_NAME_SUFFIX_POSSESSIVE_PATTERN =
  /\b([A-Z][\p{L}.'’]*(?:\s+[A-Z][\p{L}.'’]*){0,4})\s+(?:[-–—]\s+)?Research(['’]s)\s+research\b/gu;

/**
 * "this research profile" is the placeholder noun the relabels below produce for a
 * faculty row's own research home, and it is only ever acceptable where it refers to
 * the listing itself: "before contacting this research profile" (#1781). Everywhere
 * else it has to lose the placeholder, and the three patterns here are the three
 * positions a measurement of the served corpus found it in (#3094: 49 served rows).
 *
 * Position, not a verb list. The cleanup used to be a lookahead over a closed set of
 * verbs, which made it exactly as wide as that set: `utilizes`, `builds`,
 * `emphasizes` and `collaborates` were all absent and reached students verbatim, and
 * so did every possessive, because `profile's` does not match `profile\b(?=\s+verb)`
 * at all. What decides is where the phrase sits, so what is matched is the clause
 * position.
 */
/**
 * The function words that mean the phrase is an object rather than a subject. A closed
 * class is the right thing to enumerate here, unlike the verbs: English stops adding
 * prepositions and conjunctions, and it never stops adding verbs, which is why the
 * first attempt at this cleanup was exactly as wide as its own verb list (#3094).
 */
const SELF_REFERENCE_OBJECT_FOLLOWERS = [
  'about',
  'above',
  'across',
  'after',
  'against',
  'along',
  'among',
  'and',
  'around',
  'as',
  'at',
  'because',
  'before',
  'below',
  'beneath',
  'beside',
  'besides',
  'between',
  'beyond',
  'but',
  'by',
  'during',
  'for',
  'from',
  'if',
  'in',
  'inside',
  'into',
  'near',
  'nor',
  'of',
  'on',
  'onto',
  'or',
  'out',
  'outside',
  'over',
  'per',
  'since',
  'so',
  'than',
  'that',
  'through',
  'throughout',
  'to',
  'toward',
  'towards',
  'under',
  'until',
  'up',
  'upon',
  'versus',
  'via',
  'whether',
  'while',
  'with',
  'within',
  'without',
].join('|');

const SELF_REFERENCE_ADVERBS =
  'also|further|additionally|now|currently|primarily|largely|actively|therefore';

/**
 * The placeholder in a position that makes it the thing doing the research, which is
 * every position except the object of a verb or a preposition. Recognised by what
 * follows: a lowercase word that is not one of the function words above, with an
 * optional adverb between, since `also` alone accounted for six of the served rows.
 *
 * Not a verb list. `utilizes`, `builds`, `emphasizes` and `collaborates` were all
 * absent from the list this replaces, and a list is as wide as itself. Not a clause
 * position either: an intermediate version of this fix required a sentence boundary or
 * a comma before the determiner, and the served corpus has the placeholder as the
 * subject mid-sentence ("Currently this research profile is exploring", "Research at
 * this research profile focuses on"), which that version newly left in place.
 */
const SELF_REFERENTIAL_RESEARCH_PROFILE_SUBJECT_PATTERN = new RegExp(
  String.raw`\bresearch profile\b(?=(?:\s+(?:${SELF_REFERENCE_ADVERBS}))?\s+(?!(?:${SELF_REFERENCE_OBJECT_FOLLOWERS})\b)[a-z])`,
  'gi',
);

/** The placeholder's possessive, which no verb lookahead can reach at any width. */
const SELF_REFERENTIAL_RESEARCH_PROFILE_POSSESSIVE_PATTERN = /\bresearch profile(['\u2019])s\b/gi;

/**
 * The placeholder as the object of a preposition, where what is being described belongs
 * to the research rather than to the listing: "a major thrust of this research profile".
 *
 * Prepositions only, and only with a determiner between, so the object of a VERB keeps
 * the whole noun. The verbs that take it are `contacting` and `joining`, and you contact
 * a profile rather than contacting a research. That is #1781's case and it stays intact.
 */
const SELF_REFERENTIAL_RESEARCH_PROFILE_PREPOSITION_PATTERN =
  /\b(of|in|at|within|for|from|across|throughout)(\s+)(this|the|our|her|his|their)(\s+)research profile\b/gi;

/**
 * The relabel of a faculty row whose own name carries the "Faculty Research" template
 * suffix: the source writes "This lab/faculty research focuses on", the lab relabel
 * turns it into "This research profile/faculty research focuses on", and the slash
 * hides whatever follows from any lookahead.
 */
const SELF_REFERENTIAL_RESEARCH_PROFILE_FACULTY_PATTERN =
  /\bresearch profile\/faculty(\s+research)?\b/gi;

/**
 * Remove the placeholder noun this module's own relabels introduce, wherever it is not
 * referring to the listing itself.
 *
 * Exported and applied by the canonical serve sanitizer as well as inside the faculty
 * relabel chain, because a row can hold the placeholder in stored text while no longer
 * being the entity type whose relabel produced it: one Development row typed `LAB`
 * serves "Her research profile identifies interests in genetics", and
 * `sanitizeFacultyResearchEntityText` returns a non-faculty row untouched, so the
 * cleanup would never run on it. Idempotent, so running it in both places is safe.
 */
export function stripSelfReferencePlaceholderNoun(value: string): string {
  return (
    value
      .replace(SELF_REFERENTIAL_RESEARCH_PROFILE_FACULTY_PATTERN, 'research')
      .replace(SELF_REFERENTIAL_RESEARCH_PROFILE_SUBJECT_PATTERN, 'research')
      .replace(SELF_REFERENTIAL_RESEARCH_PROFILE_POSSESSIVE_PATTERN, 'research$1s')
      .replace(SELF_REFERENTIAL_RESEARCH_PROFILE_PREPOSITION_PATTERN, '$1$2$3$4research')
      // Dropping the placeholder can leave the root doubled where the source verb was
      // itself "researches", and this pass is what produces that, so it owns it.
      .replace(/\bresearch researches\b/gi, 'research examines')
      .replace(/(^|[.!?]\s+)this research\b/g, '$1This research')
  );
}

export function sanitizeFacultyResearchEntityText(
  value: string,
  entity?: FacultyResearchTextEntity | null,
): string {
  if (!isFacultyResearchTextEntity(entity)) return value;
  const baseName = facultyResearchLabelBase(entity || {});
  const possessive = baseName ? possessiveName(baseName) : "This faculty member's";

  const relabelled = value
    .replace(DOUBLED_RESEARCH_NAME_SUFFIX_POSSESSIVE_PATTERN, '$1$2 research')
    .replace(
      /^The\s+(.+?)\s+(?:Lab|Laboratory)\s+conducts\s+research\s+(?:focused\s+)?on\b/i,
      `${possessive} research focuses on`,
    )
    .replace(
      /^The\s+(.+?)\s+(?:Lab|Laboratory)\s+focuses\s+on\b/i,
      `${possessive} research focuses on`,
    )
    .replace(
      /^The\s+(.+?)\s+(?:Lab|Laboratory)\s+investigates\b/i,
      `${possessive} research investigates`,
    )
    .replace(/^The\s+(.+?)\s+(?:Lab|Laboratory)\s+studies\b/i, `${possessive} research studies`)
    .replace(
      /^The\s+(.+?)\s+(?:Lab|Laboratory)\s+is\s+connected\s+to\b/i,
      `${possessive} research is connected to`,
    )
    .replace(
      /^Research\s+in\s+the\s+(.+?)\s+(?:Lab|Laboratory)\s+centers\s+on\b/i,
      `${possessive} research centers on`,
    )
    .replace(/\bResearch\s+Lab\b/g, 'research program')
    .replace(/\b([A-Z][\p{L}.' -]{1,80}?'s)\s+lab\s+studies\b/gu, '$1 research studies')
    .replace(/\b([A-Z][\p{L}.' -]{1,80}?'s)\s+lab\s+focuses\s+on\b/gu, '$1 research focuses on')
    .replace(/\b([A-Z][\p{L}.' -]{1,80}?'s)\s+lab\s+uses\b/gu, '$1 research uses')
    .replace(/\b([A-Z][\p{L}.' -]{1,80}?'s)\s+lab\s+develops\b/gu, '$1 research develops')
    .replace(/\b([A-Z][\p{L}.' -]{1,80}?'s)\s+lab\s+investigates\b/gu, '$1 research investigates')
    .replace(/\b([A-Z][\p{L}.' -]{1,80}?(?:'|’))\s+lab\s+studies\b/gu, '$1 research studies')
    .replace(
      /\b([A-Z][\p{L}.' -]{1,80}?(?:'|’))\s+lab\s+focuses\s+on\b/gu,
      '$1 research focuses on',
    )
    .replace(/\b([A-Z][\p{L}.' -]{1,80}?(?:'|’))\s+lab\s+uses\b/gu, '$1 research uses')
    .replace(/\b([A-Z][\p{L}.' -]{1,80}?(?:'|’))\s+lab\s+develops\b/gu, '$1 research develops')
    .replace(
      /\b([A-Z][\p{L}.' -]{1,80}?(?:'|’))\s+lab\s+investigates\b/gu,
      '$1 research investigates',
    )
    .replace(/\b(His|Her|Their|his|her|their)\s+lab\s+studies\b/g, '$1 research studies')
    .replace(/\b(His|Her|Their|his|her|their)\s+lab\s+focuses\s+on\b/g, '$1 research focuses on')
    .replace(/\b(His|Her|Their|his|her|their)\s+lab\s+uses\b/g, '$1 research uses')
    .replace(/\b(His|Her|Their|his|her|their)\s+lab\s+develops\b/g, '$1 research develops')
    .replace(/\b(His|Her|Their|his|her|their)\s+lab\s+investigates\b/g, '$1 research investigates')
    .replace(
      /\b(His|Her|Their|his|her|their)\s+lab\s+is\s+interested\s+in\b/g,
      '$1 research examines',
    )
    .replace(/^My\s+lab\s+focuses\s+on\b/i, 'This research focuses on')
    .replace(/^My\s+lab\s+studies\b/i, 'This research studies')
    .replace(/\bIn\s+([^.!?]{2,100}?)\s+lab\s+we\s+study\b/i, 'In $1 research, we study')
    .replace(/\bthe\s+lab['’]s\s+work\s+includes\b/gi, 'This research includes')
    .replace(/\bthe\s+lab['’]s\s+research\s+addresses\b/gi, 'This research addresses')
    .replace(/\bthe\s+lab['’]s\s+research\b/gi, 'This research')
    .replace(/\bthe\s+lab['’]s\s+work\b/gi, 'This work')
    .replace(/\bLaboratory\b/g, 'research program')
    .replace(/\blaboratory\b/g, 'research program')
    .replace(/\b([A-Z][\p{L}.' -]{1,80}?)\s+Lab\b/gu, '$1 research group')
    .replace(/\blab site\b/gi, 'research website')
    .replace(/\blab website\b/gi, 'research website')
    .replace(/\bthe\s+lab\b/gi, 'this research profile')
    .replace(/\bthis\s+lab\b/gi, 'this research profile')
    .replace(/\bour\s+lab\b/gi, 'this research profile')
    .replace(/\byour\s+lab\b/gi, 'this research profile')
    .replace(/(^|[.!?]\s+)this research\b/g, '$1This research');

  // After the relabels, not before them. The cleanup removes the placeholder noun the
  // relabels above introduce, so running it first made it blind to this pass's own
  // output: "Our lab studies X" came out as "This research profile studies X" even
  // though `studies` was in the verb list it used (#3094). Only a value that arrived
  // already relabelled by an earlier pass was ever reachable.
  return stripSelfReferencePlaceholderNoun(relabelled);
}

const RESEARCH_HOME_SELF_NOUNS_BY_TYPE: Record<string, string> = {
  CENTER: 'center',
  INSTITUTE: 'institute',
  INITIATIVE: 'initiative',
  CORE_FACILITY: 'core facility',
};

const RESEARCH_HOME_SELF_NOUNS_BY_KIND: Record<string, string> = {
  center: 'center',
  institute: 'institute',
  initiative: 'initiative',
  group: 'group',
  program: 'program',
  core_facility: 'core facility',
};

function researchHomeSelfReferenceNoun(entity?: FacultyResearchTextEntity | null): string | null {
  if (!entity || isFacultyResearchTextEntity(entity)) return null;
  const byType = RESEARCH_HOME_SELF_NOUNS_BY_TYPE[String(entity.entityType || '').toUpperCase()];
  if (byType) return byType;
  return RESEARCH_HOME_SELF_NOUNS_BY_KIND[String(entity.kind || '').toLowerCase()] || null;
}

function matchLeadingCase(sample: string, replacement: string): string {
  if (!sample || !replacement) return replacement;
  const lead = sample.charAt(0);
  const isUpper = lead === lead.toUpperCase() && lead !== lead.toLowerCase();
  return isUpper ? replacement.charAt(0).toUpperCase() + replacement.slice(1) : replacement;
}

export function sanitizeResearchHomeSelfReferenceText(
  value: string,
  entity?: FacultyResearchTextEntity | null,
): string {
  const noun = researchHomeSelfReferenceNoun(entity);
  if (!noun) return value;
  return value.replace(
    /\b(the|this|our|your|its)(\s+)(lab|laboratory)(['’]s)?\b/gi,
    (_match, determiner: string, spacing: string, labToken: string, possessive?: string) =>
      `${determiner}${spacing}${matchLeadingCase(labToken, noun)}${possessive || ''}`,
  );
}

export function sanitizeResearchHomeSelfReferenceCopyFields<T extends Record<string, any>>(
  entity: T,
): T {
  if (!researchHomeSelfReferenceNoun(entity)) return entity;
  let changed = false;
  const next: Record<string, any> = { ...entity };

  for (const field of DESCRIPTION_AND_SYNTHESIS_FIELDS) {
    if (typeof next[field] !== 'string') continue;
    const cleaned = sanitizeResearchHomeSelfReferenceText(next[field], next);
    if (cleaned !== next[field]) {
      next[field] = cleaned;
      changed = true;
    }
  }

  return changed ? (next as T) : entity;
}

export function sanitizeFacultyResearchEntityCopyFields<T extends Record<string, any>>(
  entity: T,
  leadMemberNames: readonly string[] = [],
): T {
  if (!isFacultyResearchTextEntity(entity)) return entity;
  let changed = false;
  const next: Record<string, any> = { ...entity };

  for (const field of DESCRIPTION_AND_SYNTHESIS_FIELDS) {
    if (typeof next[field] !== 'string') continue;
    const withLeadNameCorrection = sanitizeLeadingMismatchedPersonNamePrefix(
      next[field],
      leadMemberNames,
      next,
    );
    const withLeadNameCorrectionIfResearch = guardNonResearchProfileSynthesisText(
      withLeadNameCorrection,
      next,
      field,
    );
    const cleaned = sanitizeFacultyResearchEntityText(withLeadNameCorrectionIfResearch, next);
    if (cleaned !== next[field]) {
      next[field] = cleaned;
      changed = true;
    }
  }

  return changed ? (next as T) : entity;
}

const SERVED_NAME_FIELDS = ['name', 'displayName'] as const;
const SERVED_RESEARCH_AREA_FIELDS = ['researchAreas', 'profileResearchAreas'] as const;

/**
 * Withholds a long body whose subject is a third-party organization from a
 * person-scoped record, so a department's or a core facility's prose is never
 * served as one faculty member's research (#2480).
 *
 * It runs FIRST, ahead of the text-transform layer, because that layer relabels a
 * person-scoped body's own research home ("The Smith Laboratory studies" ->
 * "The Smith research program studies") and would hand this rule an organizational
 * head noun it manufactured. The judgement belongs on the harvested prose.
 *
 * The card is withheld when it is the refused prose itself, either because it reads
 * as the same third-party subject or because it is a prefix of the body the rule
 * just refused. A card that is the person's own text is kept even on a row whose
 * body is refused, because the card is what a student reads when the body is gone
 * (#2915: 15 served rows carried the refused prose on the card, 17 carried their own).
 *
 * The card is judged on its own terms even when the body survives (#2911). A card
 * whose subject is a third-party organization is that organization's prose whatever
 * the body says, and the measurement that settled it is that the same blurb appears
 * verbatim on several different people: one school's mission on four rows, one core
 * facility's service line on three, one department's grant total on two. Prose no
 * two people can both be described by describes neither. The worry that refusing
 * both fields leaves a row with no prose does not apply here, because the card falls
 * back to a derivation from the row's own surviving body.
 *
 * Deliberately not added to `buildResearchEntityPublicDescriptionRepresentation`,
 * which is the detail route's gate: a missing full description fails that invariant
 * and 404s the row, which would remove a record that still has a lead, official
 * links and research areas rather than correct what it says. The withheld card is
 * held back from that gate for the same reason, so the gate's `cardDescription` and
 * `studentVisibilityTier`'s `missing_card_description` flag both keep judging the
 * stored card: on the rows where both are refused the row stays admitted and serves
 * its lead, links and chips with no prose, instead of vanishing. The #2906 property
 * that the gate's card and the served card agree on emptiness therefore holds
 * everywhere except here, and only a read of the served copy shows the withhold.
 *
 * Scoped by `isPersonScopedResearchEntity`, the same owner the name rule uses, so a
 * center, institute or core-facility row keeps the organizational body that is
 * correctly its own. Measured on Development: 27 served organizational rows carry a
 * body this rule would refuse and none is touched, while 9 of the 32 it does refuse
 * are `LAB` rows that the narrower text-layer person predicate would have missed.
 */
// First-person SINGULAR marks the card as the person's own statement about their
// own role, which an organization's blurb never is: an organization writes "we
// provide" or "the core supports", never "I support". It is checked separately
// from the subject rule because a leading role clause ("As co-Director of the ...
// Core, I support and foster research ...") puts the organization in the same
// position the subject rule reads, so that rule alone cannot tell the two apart.
const FIRST_PERSON_SINGULAR_PROSE = /(?:^|[^\p{L}])(?:I|I['’]m|I['’]ve|my)(?:[^\p{L}]|$)/u;

const isFirstPersonSingularProse = (value: string): boolean =>
  FIRST_PERSON_SINGULAR_PROSE.test(value);

function withoutAnotherOrganizationsBody<T extends Record<string, any>>(
  entity: T,
  leadMemberNames: readonly string[],
): { entity: T; withheldBody: string; withheldCard: string } {
  const nothingWithheld = { entity, withheldBody: '', withheldCard: '' };
  if (!isPersonScopedResearchEntity(entity)) return nothingWithheld;
  const describesAnotherOrganization = (description: unknown) =>
    personScopedResearchEntityBodyDescribesAnotherOrganization({
      description,
      name: entity.name,
      displayName: entity.displayName,
      slug: entity.slug,
      personName: leadMemberNames.join(' '),
    });
  const next: Record<string, any> = { ...entity };
  const refusedBodies: string[] = [];
  for (const field of HYGIENE_FULL_DESCRIPTION_FIELDS) {
    if (typeof next[field] !== 'string' || !next[field].trim()) continue;
    if (describesAnotherOrganization(next[field])) {
      refusedBodies.push(next[field]);
      next[field] = '';
    }
  }
  const card = typeof next.shortDescription === 'string' ? next.shortDescription : '';
  const comparable = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();
  const cardIsTheRefusedProse =
    Boolean(card.trim()) &&
    !isFirstPersonSingularProse(card) &&
    (describesAnotherOrganization(card) ||
      refusedBodies.some((body) => comparable(body).includes(comparable(card))));
  if (cardIsTheRefusedProse) next.shortDescription = '';
  if (refusedBodies.length === 0 && !cardIsTheRefusedProse) return nothingWithheld;
  return {
    entity: next as T,
    withheldBody: refusedBodies[0] ?? '',
    withheldCard: cardIsTheRefusedProse ? card : '',
  };
}

/**
 * Withholds a `profileSynthesisDescription` whose biographical subject is a
 * different person who shares a name with the record's own (#1922).
 *
 * The URL axis already has a guard: `detectProfileIdentityRisk` compares the
 * record's own person-profile links against the resolved lead. Nothing compared
 * the synthesis PROSE, so a graft that arrived on a first-name match survived an
 * identity refresh that corrected `name`, `fullDescription`, `shortDescription`
 * and `researchAreas`, and kept being served. Measured on Development: 1 of the
 * 343 live rows carrying a synthesis is a different person's biography, and it is
 * `student_ready`.
 *
 * Only the synthesis field is judged, not the body. A synthesis is a biography by
 * construction, so a person-subject reading is the expected shape there; a lab
 * body opening with its PI's name is the expected shape too, and refusing on the
 * same test would cost real bodies for no measured gain.
 *
 * Withheld rather than substituted, and not fed to the visibility gate, for the
 * same reason the organization rule above is not: `descriptionStateForEntity`
 * reads a present synthesis as `profile_synthesis`, so a row whose synthesis is
 * refused keeps whatever its own body and card earn instead of dropping a tier on
 * prose it never should have carried.
 */
function withoutAnotherPersonsSynthesis<T extends Record<string, any>>(
  entity: T,
  leadMemberNames: readonly string[],
): { entity: T; withheldSynthesis: string } {
  const synthesis =
    typeof entity.profileSynthesisDescription === 'string'
      ? entity.profileSynthesisDescription
      : '';
  if (!synthesis.trim()) return { entity, withheldSynthesis: '' };
  if (!isPersonScopedResearchEntity(entity)) return { entity, withheldSynthesis: '' };
  const describesAnotherPerson = (description: unknown) =>
    personSynthesisDescribesAnotherPerson({
      description,
      name: entity.name,
      displayName: entity.displayName,
      slug: entity.slug,
      personName: leadMemberNames.join(' '),
    });
  if (!describesAnotherPerson(synthesis)) return { entity, withheldSynthesis: '' };
  const next: Record<string, any> = { ...entity, profileSynthesisDescription: '' };
  const card = typeof next.shortDescription === 'string' ? next.shortDescription : '';
  const comparable = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();
  if (card.trim() && comparable(synthesis).includes(comparable(card))) {
    next.shortDescription = '';
  }
  return { entity: next as T, withheldSynthesis: synthesis };
}

/**
 * Serve-time fail-safe for a research-entity name/title: collapse a doubled
 * research-home suffix ("Smith Lab Lab", "Foo Research Research") that a stored
 * name can still carry when it predates the materialize-time normalization
 * (#1108). The materialize seam owns the fuller name normalization (dash and
 * trailing-description repair); serve only needs this idempotent fail-safe so
 * every surface renders the same collapsed name.
 */
export function sanitizeServedResearchEntityName(value: unknown): string {
  return typeof value === 'string' ? collapseDuplicateResearchHomeSuffix(value) : '';
}

/**
 * Serve-time research-area chip hygiene: split bare comma-delimited blobs
 * (#884), strip role-label suffixes / fail closed on prose, corrupt, and
 * label-leak chips (#877/#1029/#867), dedupe, then drop prose-sentence chips
 * (#870). Idempotent, so a re-run over already-clean chips is a no-op.
 */
const MAX_SERVED_RESEARCH_AREA_CHIPS = 200;

export function sanitizeServedResearchAreaChips(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const labels: string[] = [];
  const boundedInput = values
    .slice(0, MAX_SERVED_RESEARCH_AREA_CHIPS)
    .filter((v): v is string => typeof v === 'string');
  for (const raw of normalizeResearchAreaList(boundedInput)) {
    const cleaned = sanitizeResearchAreaLabel(raw);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(cleaned);
  }
  return filterProseResearchAreaChips(labels);
}

/**
 * The single canonical serve-time sanitizer for a served research entity: the
 * one "clean this entity before serving" entry point that every public serve
 * path (detail, browse/search cards, embedded summaries, saved-plan cards,
 * profile research-home lists) must run, so a guard added to any underlying
 * layer takes effect on every surface at once rather than only on whichever
 * serve path happened to run its subset (#1269/#1374).
 *
 * It composes the full guard union in a fixed order:
 *  1. the text-transform layer (researchEntityDescriptionText) - subjectless-lead
 *     repair, first-person re-voicing, mismatched-name-prefix correction, the
 *     non-person-org biography guard, the publicResearchEntityDescriptionText
 *     fail-closed gate (appointment-only, role-only, chrome, synthetic, contact
 *     route, directory-index, broken fragment), and last the orphaned
 *     third-person re-voicing that has to see the post-gate body (#1871);
 *  2. the faculty relabel pass ("the Lab" -> "this research profile"), whose placeholder
 *     noun is then stripped wherever it is not referring to the listing itself (#3094),
 *     here as well as inside that pass, because a row can hold the placeholder in
 *     stored text while no longer being the entity type whose relabel produced it;
 *  3. the research-home self-reference pass ("the lab" -> "the center");
 *  4. the descriptionHygiene layer (chrome/dump strip, contact-block/publications/
 *     center-blurb/html fail-close, and length clamp) that the DTO already ran
 *     but the text/quality serve path did not;
 *  5. the name fail-safe (doubled research-home suffix collapse) and the
 *     research-area chip hygiene (split/relabel/fail-close/prose-drop), so a
 *     serve path that never touched the DTO's per-field helpers still emits the
 *     same names and chips as every other surface;
 *  6. the unsourced research-area domain-coherence guard (#1407 second
 *     mechanism): a `researchAreas` chip with no `fieldProvenance.researchAreas`
 *     backing and zero vocabulary overlap with the entity's own sourced text is
 *     dropped, since there is no provenance trail to reconcile it against.
 *  7. the name identity guard: a `displayName` that is filler rather than an
 *     identity ("n/a", "unknown"), or that names an umbrella organization the
 *     record merely belongs to or another person's lab, is withheld so every
 *     surface falls back to `name` (#2234/#2351/#2367). It belongs here rather
 *     than in one DTO because the saved-plan and profile serve paths build their
 *     own summaries and would otherwise keep titling their cards with the graft.
 *
 * Ahead of all of it, `withoutAnotherOrganizationsBody` withholds a person-scoped
 * row's long body when its subject is a third-party organization (#2480), and
 * `withoutAnotherPersonsSynthesis` withholds its `profileSynthesisDescription`
 * when that biography's subject is a different person sharing a name with the
 * record's own (#1922). Both run first because step 2 relabels a person-scoped
 * body's own research home into an organizational head noun and re-voices
 * first-person prose, and neither rule may read a transform's own output as
 * evidence of whose prose this is.
 *
 * Every step is idempotent, so a description already cleaned upstream (the detail
 * path runs the text-transform layer before the DTO) is unchanged by a second
 * pass. Returns the input entity unchanged when nothing needed cleaning.
 */
export function sanitizeServedResearchEntityCopyFields<T extends Record<string, any>>(
  entity: T,
  leadMemberNames: readonly string[] = [],
): T {
  const ownSubject = withoutAnotherOrganizationsBody(entity, leadMemberNames);
  const ownBiography = withoutAnotherPersonsSynthesis(ownSubject.entity, leadMemberNames);
  const withTextGuards = sanitizeResearchHomeSelfReferenceCopyFields(
    sanitizeFacultyResearchEntityCopyFields(
      sanitizeResearchEntityPublicDescriptionFields(ownBiography.entity, leadMemberNames),
      leadMemberNames,
    ),
  );
  let changed = withTextGuards !== entity;
  const next: Record<string, any> = { ...withTextGuards };

  HYGIENE_FULL_DESCRIPTION_FIELDS.forEach((field, index) => {
    if (typeof next[field] !== 'string') return;
    const areaField = SERVED_RESEARCH_AREA_FIELDS[index];
    let cleaned = stripSelfReferencePlaceholderNoun(sanitizeResearchEntityDescription(next[field]));
    if (isStudiesResearchAreaEchoDescription(cleaned, next[areaField])) cleaned = '';
    if (cleaned !== next[field]) {
      next[field] = cleaned;
      changed = true;
    }
  });
  if (typeof next.shortDescription === 'string') {
    let cleaned = stripSelfReferencePlaceholderNoun(
      sanitizeResearchEntityShortDescription(next.shortDescription),
    );
    if (isStudiesResearchAreaEchoDescription(cleaned, next[SERVED_RESEARCH_AREA_FIELDS[0]])) {
      cleaned = '';
    }
    if (cleaned !== next.shortDescription) {
      next.shortDescription = cleaned;
      changed = true;
    }
  }

  for (const field of SERVED_NAME_FIELDS) {
    if (typeof next[field] !== 'string') continue;
    const cleaned = sanitizeServedResearchEntityName(next[field]);
    if (cleaned !== next[field]) {
      next[field] = cleaned;
      changed = true;
    }
  }

  // A bare person name titles the card with a person, and the person page is
  // retired, so the served name becomes the research record the row actually is.
  // A substitution rather than a withhold: `name` is the heading every serve path
  // falls back to once `displayName` is refused below, so clearing it would serve
  // a blank heading (#2373/#2507).
  for (const field of SERVED_NAME_FIELDS) {
    if (typeof next[field] !== 'string' || !next[field]) continue;
    const derived = personScopedResearchEntityNameFromPersonName({
      candidateName: next[field],
      entityType: next.entityType,
      kind: next.kind,
    });
    if (derived && derived !== next[field]) {
      next[field] = derived;
      changed = true;
    }
  }

  // The lead names this function already holds. Withholding them left the shape gate
  // in `personScopedNameIdentityPrelude` on its type arm alone, and a graft that
  // asserts an organization's `entityType` alongside its name switches that arm off for
  // exactly the rows it grafted, so the #2913 key-names-only-this-person arm could
  // never fire at serve time: 6 served rows carrying another organization's `name`
  // became reachable the moment the names were passed (#3132).
  const leadPersonName = leadMemberNames.join(' ');
  const namesAnotherOrganization = (candidateName: unknown, field: string): boolean =>
    typeof candidateName === 'string' &&
    candidateName.length > 0 &&
    personScopedResearchEntityNameNamesSomethingElseByUrlPath({
      candidateName,
      entityType: next.entityType,
      kind: next.kind,
      slug: next.slug,
      personName: leadPersonName,
      websiteUrl: next.fieldProvenance?.[field]?.sourceUrl || next.websiteUrl || next.website || '',
      recordCitedUrls: [next.websiteUrl, next.website, next.sourceUrls],
    });

  // `name` is substituted and never cleared, because it is the heading every serve path
  // falls back to once `displayName` is refused below. The substitution is the same one
  // the materializer applies, so a row the harvest has not re-reached still reads as the
  // research record it is rather than as the organization grafted onto it (#2369).
  if (namesAnotherOrganization(next.name, 'name')) {
    const fromLead = personScopedResearchEntityNameFromLeadPersonName({
      entityType: next.entityType,
      kind: next.kind,
      slug: next.slug,
      personName: leadPersonName,
      leadPersonName: leadMemberNames[0],
    });
    if (fromLead && fromLead !== next.name) {
      next.name = fromLead;
      changed = true;
    }
  }

  if (
    typeof next.displayName === 'string' &&
    next.displayName &&
    (isPlaceholderEntityName(next.displayName) ||
      namesAnotherOrganization(next.displayName, 'displayName'))
  ) {
    next.displayName = '';
    changed = true;
  }

  for (const field of SERVED_RESEARCH_AREA_FIELDS) {
    if (!Array.isArray(next[field])) continue;
    const cleaned = sanitizeServedResearchAreaChips(next[field]);
    const current = next[field] as unknown[];
    if (
      cleaned.length !== current.length ||
      cleaned.some((value, index) => value !== current[index])
    ) {
      next[field] = cleaned;
      changed = true;
    }
  }

  if (Array.isArray(next.researchAreas)) {
    const coherent = dropDomainIncoherentUnsourcedResearchAreas(
      next.researchAreas as string[],
      next.fieldProvenance,
      {
        name: next.name,
        displayName: next.displayName,
        departments: next.departments,
        // The withheld body and card, when #2480/#2915 withheld them. Withholding
        // prose is a judgement about whose prose it is, not about whether a chip
        // belongs, and this guard drops an unsourced chip that overlaps no served
        // text: reading the blanked field instead cost 5 of the 32 withheld rows
        // every chip they had, and with the chips went the chips-derived card on 2
        // of them, so a student lost the topics as collateral on a body fix.
        shortDescription: next.shortDescription || ownSubject.withheldCard,
        fullDescription: next.fullDescription || ownSubject.withheldBody,
      },
    );
    if (coherent !== next.researchAreas) {
      next.researchAreas = coherent;
      changed = true;
    }
  }

  // Last, because it is the only judgement here that has to read the FINAL chip row.
  // A card in the chip-summary shape was written from the chips as they were, and the
  // passes above are one of the ways they move: the chip hygiene and the unsourced
  // domain-coherence guard both drop chips, and a scrape or a graft retirement drops
  // more. Nothing re-derives the card, so it keeps asserting a topic the pills beside
  // it no longer show (#3095). Blanking sends it back through the resolver's
  // derivation chain, which prefers a body-derived line and falls back to a summary of
  // the chips that survived.
  //
  // It must also run after `dropDomainIncoherentUnsourcedResearchAreas`, which reads
  // this card as evidence for whether an unsourced chip overlaps any served text.
  if (
    typeof next.shortDescription === 'string' &&
    isStaleResearchAreaChipEnumeration(next.shortDescription, next.researchAreas)
  ) {
    next.shortDescription = '';
    changed = true;
  }

  return changed ? (next as T) : entity;
}
