import {
  hasContactBlockResidue,
  isCitationAuthorListDumpText,
  isConnectedToKeywordListStub,
  isInstitutionalCenterBlurbText,
  isStudiesResearchAreaEchoDescription,
  sanitizeResearchEntityDescription,
  sanitizeResearchEntityShortDescription,
} from './descriptionHygiene';
import { collapseDuplicateResearchHomeSuffix } from './researchEntityNameNormalization';
import { normalizeResearchAreaList } from './researchAreaHygiene';
import { sanitizeResearchAreaLabel } from './researchAreaLabelHygiene';
import { filterProseResearchAreaChips } from './profileResearchTerms';
import { dropDomainIncoherentUnsourcedResearchAreas } from './researchAreaDomainCoherence';
import { isProgramLikeResearchEntity } from './researchEntityProgramLike';

const DESCRIPTION_FIELDS = ['shortDescription', 'fullDescription'] as const;
const DESCRIPTION_AND_SYNTHESIS_FIELDS = [
  ...DESCRIPTION_FIELDS,
  'profileSynthesisDescription',
] as const;

const HYGIENE_FULL_DESCRIPTION_FIELDS = ['fullDescription', 'profileSynthesisDescription'] as const;
const NON_MATCHED_PROFILE_SUMMARY_RESEARCH_HINT =
  /\b(?:research|lab|laboratory|study|studies|studying|investigate|investigates|investigated|explore|explores|focus|focuses|focusing|works?\s+on|conducts|uses|develops|examines|examining|analysis|method|methods|model|models|projects?|theory|algorithm|algorithms|approach|approaches|data|paper|papers?|publications?)\b/i;

type FacultyResearchTextEntity = {
  displayName?: string | null;
  name?: string | null;
  kind?: string | null;
  entityType?: string | null;
};

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

const LEAD_NAME_TOKENIZERS = [
  /\bdr\.?\b/gi,
  /\bprof\.?\b/gi,
  /\bprofessor\b/gi,
  /\bm\.?d\.?\b/gi,
];

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
    .map((token) => LEAD_NAME_TOKENIZERS.reduce((next, pattern) => next.replace(pattern, ''), token))
    .map((token) => token.trim())
    .filter(Boolean);
}

function leadNamesMatchTextValue(
  candidate: string,
  leadMemberNames: readonly string[],
): boolean {
  const candidateTokens = normalizePersonNameTokens(candidate);
  if (candidateTokens.length < 2) return false;
  const lastIndex = candidateTokens[candidateTokens.length - 1];
  const candidateLastToken = lastIndex.length === 1 ? candidateTokens.at(-2) || '' : lastIndex;
  if (!candidateLastToken) return false;

  const firstName = candidateTokens[0];
  return leadMemberNames.some((leadName) => {
    const leadTokens = normalizePersonNameTokens(leadName);
    if (leadTokens.length < 2) return false;
    return leadTokens.includes(firstName) && leadTokens.includes(candidateLastToken);
  });
}

// A card synthesized from research prose opens with a research-description verb
// ("Studies Ménétrier's disease", "Studies Ivan Goncharov's travelogue"): here the
// capitalized possessive is the eponymous object of study, not the entity's own
// lead name, so the mismatched-person-name strip below must not fire and blank it.
const RESEARCH_LEAD_VERB_PREFIX_TOKEN =
  /^(?:studies|study|investigates|investigate|examines|examine|explores|explore|develops|develop|focuses|focus|focused|advances|advance|supports|support|fosters|foster|combines|combine|conducts|conduct|builds|build|designs|design|creates|create|analyzes|analyze|analyses|analyse|models|model|measures|measure|researches|research|seeks|seek|works|work|uses|use|employs|employ|innovates|innovate|enhances|enhance|improves|improve|unites|unite|provides|provide)$/i;

function sanitizeLeadingMismatchedPersonNamePrefix(
  value: string,
  leadMemberNames: readonly string[] = [],
): string {
  if (!leadMemberNames.length) return value;
  const match = value.match(
    /^([A-Z][\p{L}.'’-]+(?:\s+[A-Z][\p{L}.'’-]+){1,4})['’]s\s+/u,
  );
  if (!match) return value;
  if (RESEARCH_LEAD_VERB_PREFIX_TOKEN.test(match[1].split(/\s+/)[0])) return value;
  if (leadNamesMatchTextValue(match[1], leadMemberNames)) return value;
  const remainder = value.slice(match[0].length);
  if (!NON_MATCHED_PROFILE_SUMMARY_RESEARCH_HINT.test(remainder)) return '';
  return `This ${remainder}`;
}

function isLikelyResearchFocusedText(value: string): boolean {
  return NON_MATCHED_PROFILE_SUMMARY_RESEARCH_HINT.test(textValue(value));
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
    isResearchEntitySourceChromeText(cleaned) ||
    isInstitutionalCenterBlurbText(cleaned)
  ) {
    return '';
  }
  return cleaned;
}

const NON_PERSON_ORG_ENTITY_TYPES = new Set([
  'PROGRAM',
  'RA_PROGRAM',
  'FELLOWSHIP_PROGRAM',
  'COURSE_SEQUENCE',
  'CENTER',
  'INSTITUTE',
  'INITIATIVE',
  'COLLECTIONS_INITIATIVE',
  'DIGITAL_HUMANITIES_PROJECT',
  'ARCHIVE_OR_MUSEUM_PROJECT',
  'GROUP',
  'CORE_FACILITY',
]);

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

const PERSON_BIOGRAPHY_OPENER_PATTERN =
  /^[A-Z][\p{L}.'’-]+(?:\s+[A-Z][\p{L}.'’-]+){0,3}(?:,\s*(?:PhD|Ph\.D\.?|MD|M\.D\.?|MPH|ScD|Sc\.D\.?|DPhil|JD|MS|MA|MBA|EdD)\b\.?)?\s+is\s+(?:the|an?)\s+(?:[\p{L}][\p{L}'’-]*[\s,/-]+){0,8}Professor\b/u;

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

function stripPersonBiographyOpenerSentence(value: string): string {
  const match = value.match(PERSON_BIOGRAPHY_OPENER_PATTERN);
  if (!match || match.index === undefined) return value;
  const openerEnd = match.index + match[0].length;
  const sentenceTail = value.slice(openerEnd).match(/^[^.!?]*[.!?]+\s*/);
  const consumedEnd = sentenceTail ? openerEnd + sentenceTail[0].length : value.length;
  return value.slice(consumedEnd).trim();
}

/**
 * Faculty/individual entities can otherwise have a genuinely good research
 * description that simply opens with a routine appointment sentence ("Elleza
 * Kelley is an Assistant Professor of English..."). Drop only that opening
 * sentence and keep the remainder when it still reads as a research
 * description on its own, instead of blanking the whole field (#1586).
 */
function repairFacultyBiographyOpener(value: string): string {
  const stripped = stripPersonBiographyOpenerSentence(value);
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

const PERSONAL_PAGE_GREETING_PATTERN = /^(?:welcome to\b[^.!?]*[.!?]+\s*)+/i;

function countWords(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}

function stripLeadingPersonalGreeting(value: string): string {
  const match = value.match(PERSONAL_PAGE_GREETING_PATTERN);
  if (!match) return value;
  const remainder = value.slice(match[0].length).trim();
  if (countWords(remainder) < 6) return value;
  return remainder;
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
];

const FIRST_PERSON_VERB_ALTERNATION = [
  ...Object.keys(THIRD_PERSON_SINGULAR_PRESENT_VERB_FORMS),
  ...FIRST_PERSON_PAST_OR_MODAL_VERBS,
].join('|');

function conjugateFirstPersonVerbToThirdPersonSingular(verb: string): string {
  return THIRD_PERSON_SINGULAR_PRESENT_VERB_FORMS[verb.toLowerCase()] || verb;
}

const SINGULAR_NOUN_S_ENDING_EXCEPTIONS = /(?:ss|us|is|ics)$/i;

function pluralAwareDemonstrative(noun: string): string {
  return /s$/i.test(noun) && !SINGULAR_NOUN_S_ENDING_EXCEPTIONS.test(noun) ? 'These' : 'This';
}

const FIRST_PERSON_LEAD_REVOICE_RULES: ReadonlyArray<
  readonly [RegExp, string | ((...groups: string[]) => string)]
> = [
  [/(^|[.!?]\s+)(?:I\s+am|I['’]m)\s+(an?|the)\s+/gi, '$1This researcher is $2 '],
  [/(^|[.!?]\s+)(?:My|Our)\s+careers?\b/gi, "$1This researcher's career"],
  [/(^|[.!?]\s+)(?:My|Our)\s+group\b/gi, '$1This research group'],
  [
    new RegExp(`(^|[.!?]\\s+)We\\s+(${FIRST_PERSON_VERB_ALTERNATION})\\b`, 'g'),
    (_match: string, lead: string, verb: string) =>
      `${lead}This group ${conjugateFirstPersonVerbToThirdPersonSingular(verb)}`,
  ],
  [
    new RegExp(`(^|[.!?]\\s+)I\\s+(${FIRST_PERSON_VERB_ALTERNATION})\\b`, 'g'),
    (_match: string, lead: string, verb: string) =>
      `${lead}This researcher ${conjugateFirstPersonVerbToThirdPersonSingular(verb)}`,
  ],
  [
    /(^|[.!?]\s+)(?:My|Our)\s+(\w+)\b/g,
    (_match: string, lead: string, noun: string) => `${lead}${pluralAwareDemonstrative(noun)} ${noun}`,
  ],
];

export function revoiceFirstPersonResearchLead(value: unknown): string {
  const text = typeof value === 'string' ? value : '';
  if (!text) return text;
  let next = stripLeadingPersonalGreeting(text);
  for (const [pattern, replacement] of FIRST_PERSON_LEAD_REVOICE_RULES) {
    next = next.replace(pattern, replacement as any);
  }
  return next;
}

export function sanitizeResearchEntityPublicDescriptionFields<T extends Record<string, any>>(
  entity: T,
  leadMemberNames: readonly string[] = [],
): T {
  let changed = false;
  const next: Record<string, any> = { ...entity };
  const rejectPersonBiography = isNonPersonOrgEntityType(next);
  const shouldGuardPersonBiography = rejectPersonBiography || isFacultyResearchTextEntity(next);

  for (const field of DESCRIPTION_AND_SYNTHESIS_FIELDS) {
    if (field in next) {
      if (typeof next[field] !== 'string') continue;
      if (shouldGuardPersonBiography && isPersonBiographyOrAdvisingDescription(next[field])) {
        const repaired = isFacultyResearchTextEntity(next)
          ? repairFacultyBiographyOpener(next[field])
          : '';
        if (repaired !== next[field]) {
          next[field] = repaired;
          changed = true;
        }
        continue;
      }
      const withResearchLeadRepair = repairSubjectlessResearchLead(next[field]);
      const withFirstPersonReVoice =
        field === 'shortDescription'
          ? withResearchLeadRepair
          : revoiceFirstPersonResearchLead(withResearchLeadRepair);
      const withLeadNameCorrection = sanitizeLeadingMismatchedPersonNamePrefix(
        withFirstPersonReVoice,
        leadMemberNames,
      );
      const withLeadNameCorrectionIfResearch =
        String(next.descriptionSource) === 'PI_PROFILE_SYNTHESIS' &&
        !isLikelyResearchFocusedText(withLeadNameCorrection)
          ? ''
          : withLeadNameCorrection;
      const withFundingProgramStudiesGuard =
        field === 'shortDescription' &&
        isResearcherVoiceStudiesLeadOnFundingProgram(withLeadNameCorrectionIfResearch, next)
          ? ''
          : withLeadNameCorrectionIfResearch;
      const cleaned = publicResearchEntityDescriptionText(withFundingProgramStudiesGuard);
      if (cleaned !== next[field]) {
        next[field] = cleaned;
        changed = true;
      }
    }
  }

  if ('summary' in next) {
    const guardedSummary =
      shouldGuardPersonBiography && isPersonBiographyOrAdvisingDescription(next.summary)
        ? isFacultyResearchTextEntity(next)
          ? repairFacultyBiographyOpener(next.summary)
          : ''
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

function facultyResearchLabelBase(entity: FacultyResearchTextEntity): string {
  return textValue(entity.displayName || entity.name)
    .replace(/\s*[-–—]\s*Research$/i, '')
    .replace(/\s+(?:Faculty Research|Lab|Laboratory|Research)$/i, '')
    .trim();
}

function possessiveName(name: string): string {
  return name.endsWith('s') ? `${name}'` : `${name}'s`;
}

export function sanitizeFacultyResearchEntityText(
  value: string,
  entity?: FacultyResearchTextEntity | null,
): string {
  if (!isFacultyResearchTextEntity(entity)) return value;
  const baseName = facultyResearchLabelBase(entity || {});
  const possessive = baseName ? possessiveName(baseName) : "This faculty member's";

  return value
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
    .replace(
      /^The\s+(.+?)\s+(?:Lab|Laboratory)\s+studies\b/i,
      `${possessive} research studies`,
    )
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
    .replace(/\b([A-Z][\p{L}.' -]{1,80}?(?:'|’))\s+lab\s+focuses\s+on\b/gu, '$1 research focuses on')
    .replace(/\b([A-Z][\p{L}.' -]{1,80}?(?:'|’))\s+lab\s+uses\b/gu, '$1 research uses')
    .replace(/\b([A-Z][\p{L}.' -]{1,80}?(?:'|’))\s+lab\s+develops\b/gu, '$1 research develops')
    .replace(/\b([A-Z][\p{L}.' -]{1,80}?(?:'|’))\s+lab\s+investigates\b/gu, '$1 research investigates')
    .replace(/\b(His|Her|Their|his|her|their)\s+lab\s+studies\b/g, '$1 research studies')
    .replace(/\b(His|Her|Their|his|her|their)\s+lab\s+focuses\s+on\b/g, '$1 research focuses on')
    .replace(/\b(His|Her|Their|his|her|their)\s+lab\s+uses\b/g, '$1 research uses')
    .replace(/\b(His|Her|Their|his|her|their)\s+lab\s+develops\b/g, '$1 research develops')
    .replace(/\b(His|Her|Their|his|her|their)\s+lab\s+investigates\b/g, '$1 research investigates')
    .replace(/\b(His|Her|Their|his|her|their)\s+lab\s+is\s+interested\s+in\b/g, '$1 research examines')
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
}

const RESEARCH_HOME_SELF_NOUNS_BY_TYPE: Record<string, string> = {
  CENTER: 'center',
  INSTITUTE: 'institute',
  INITIATIVE: 'initiative',
  COLLECTIONS_INITIATIVE: 'initiative',
  DIGITAL_HUMANITIES_PROJECT: 'project',
  ARCHIVE_OR_MUSEUM_PROJECT: 'project',
  GROUP: 'group',
  CORE_FACILITY: 'core facility',
  PROGRAM: 'program',
  RA_PROGRAM: 'program',
  FELLOWSHIP_PROGRAM: 'program',
  COURSE_SEQUENCE: 'program',
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
    );
    const withLeadNameCorrectionIfResearch =
      String(next.descriptionSource) === 'PI_PROFILE_SYNTHESIS' &&
      !isLikelyResearchFocusedText(withLeadNameCorrection)
        ? ''
        : withLeadNameCorrection;
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
 *     non-person-org biography guard, and the publicResearchEntityDescriptionText
 *     fail-closed gate (appointment-only, role-only, chrome, synthetic, contact
 *     route, directory-index, broken fragment);
 *  2. the faculty relabel pass ("the Lab" -> "this research profile");
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
 *
 * Every step is idempotent, so a description already cleaned upstream (the detail
 * path runs the text-transform layer before the DTO) is unchanged by a second
 * pass. Returns the input entity unchanged when nothing needed cleaning.
 */
export function sanitizeServedResearchEntityCopyFields<T extends Record<string, any>>(
  entity: T,
  leadMemberNames: readonly string[] = [],
): T {
  const withTextGuards = sanitizeResearchHomeSelfReferenceCopyFields(
    sanitizeFacultyResearchEntityCopyFields(
      sanitizeResearchEntityPublicDescriptionFields(entity, leadMemberNames),
      leadMemberNames,
    ),
  );
  let changed = withTextGuards !== entity;
  const next: Record<string, any> = { ...withTextGuards };

  HYGIENE_FULL_DESCRIPTION_FIELDS.forEach((field, index) => {
    if (typeof next[field] !== 'string') return;
    const areaField = SERVED_RESEARCH_AREA_FIELDS[index];
    let cleaned = sanitizeResearchEntityDescription(next[field]);
    if (isStudiesResearchAreaEchoDescription(cleaned, next[areaField])) cleaned = '';
    if (cleaned !== next[field]) {
      next[field] = cleaned;
      changed = true;
    }
  });
  if (typeof next.shortDescription === 'string') {
    let cleaned = sanitizeResearchEntityShortDescription(next.shortDescription);
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

  for (const field of SERVED_RESEARCH_AREA_FIELDS) {
    if (!Array.isArray(next[field])) continue;
    const cleaned = sanitizeServedResearchAreaChips(next[field]);
    const current = next[field] as unknown[];
    if (cleaned.length !== current.length || cleaned.some((value, index) => value !== current[index])) {
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
        shortDescription: next.shortDescription,
        fullDescription: next.fullDescription,
      },
    );
    if (coherent !== next.researchAreas) {
      next.researchAreas = coherent;
      changed = true;
    }
  }

  return changed ? (next as T) : entity;
}
