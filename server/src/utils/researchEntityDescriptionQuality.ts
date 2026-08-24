import {
  collapseDoubledConjunction,
  collapseDoubledSynthesisVerb,
  hasContactBlockResidue,
  isCitationAuthorListDumpText,
  isConnectedToKeywordListStub,
  isNonSelfContainedShortDescription,
  isResearchAreaTemplateLeakText,
  isStudiesResearchAreaEchoDescription,
  isStudiesTemplateGlueMalformed,
} from './descriptionHygiene';
import {
  isAcademicAppointmentDescription,
  isBrokenResearchEntityDescriptionFragment,
  isResearchAreaPlaceholderDescription,
  isResearchEntitySourceChromeText,
  isRoleOnlyTitleFragment,
  isSyntheticResearchHomeMetadataDescription,
  publicResearchEntityDescriptionText,
} from './researchEntityDescriptionText';

export type DescriptionQualityFlag =
  | 'blank'
  | 'too-short'
  | 'too-long'
  | 'synthetic-placeholder'
  | 'broken-template'
  | 'profile-chrome'
  | 'research-area-placeholder'
  | 'research-area-echo'
  | 'area-echo-fallback'
  | 'appointment-only'
  | 'role-only'
  | 'incomplete-sentence'
  | 'duplicated-fragment'
  | 'recruitment-boilerplate'
  | 'consent-boilerplate'
  | 'source-news-fragment'
  | 'paper-fragment'
  | 'same-as-full'
  | 'copied-first-sentence'
  | 'first-person'
  | 'generic-lead'
  | 'malformed-generated-text'
  | 'non-self-contained'
  | 'non-offer-clause'
  | 'administrative-chrome'
  | 'topic-label-list'
  | 'ungrounded-topic-short'
  | 'full-not-useful';

export interface ResearchEntityDescriptionQualityInput {
  fullDescription?: unknown;
  shortDescription?: unknown;
  researchAreas?: unknown;
  sourceUrls?: unknown;
  website?: unknown;
  websiteUrl?: unknown;
  isProgramLike?: boolean;
  entityType?: unknown;
}

export interface FieldQuality {
  text: string;
  isUseful: boolean;
  flags: DescriptionQualityFlag[];
}

export interface ResearchEntityDescriptionQuality {
  full: FieldQuality;
  short: FieldQuality;
  sourceEligible: boolean;
  cardState: 'complete' | 'sparse';
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const INITIAL_DOT_TOKEN = '<initialdot>';

const sentenceList = (value: string): string[] => {
  const protectedText = textValue(value)
    .replace(/(\d)\.(?=\d)/g, `$1${INITIAL_DOT_TOKEN}`)
    .replace(/\bU\.S\./g, `U${INITIAL_DOT_TOKEN}S${INITIAL_DOT_TOKEN}`)
    .replace(/\bPh\.D\./g, `Ph${INITIAL_DOT_TOKEN}D${INITIAL_DOT_TOKEN}`)
    .replace(/\b(Dr|Prof|Mr|Mrs|Ms|St)\./g, `$1${INITIAL_DOT_TOKEN}`)
    .replace(
      /\b([A-Z])\.(?=\s+[A-Z][A-Za-z.'-]+)/g,
      `$1${INITIAL_DOT_TOKEN}`,
    );
  return (
    protectedText
      .match(/[^.!?]+[.!?]+(?:\s|$|(?=[A-Z]))|[^.!?]+$/g)
      ?.map((sentence) => sentence.split(INITIAL_DOT_TOKEN).join('.').trim()) || []
  );
};

const wordCount = (value: string): number => textValue(value).split(/\s+/).filter(Boolean).length;

const uniqueFlags = (flags: DescriptionQualityFlag[]): DescriptionQualityFlag[] =>
  Array.from(new Set(flags));

const hasUsableSource = (input: ResearchEntityDescriptionQualityInput): boolean =>
  Boolean(textValue(input.websiteUrl) || textValue(input.website)) ||
  (Array.isArray(input.sourceUrls) &&
    input.sourceUrls.some((url) => /^https?:/i.test(textValue(url))));

const hasBrokenTemplate = (value: string): boolean =>
  /(?:\sand\s\.)|\bconnected to\s*\./i.test(value);

const hasRecruitmentBoilerplate = (value: string): boolean =>
  /\bthank you for your interest in (?:our|the) lab(?:oratory)?\b/i.test(value) ||
  /\bwe are always looking for motivated\b/i.test(value) ||
  /\bwelcome to (?:the )?(?:home\s*page|homepage|website) of\b/i.test(value) ||
  /\bwelcome to (?:the )?.{0,80}\b(?:lab|laboratory)\s+(?:home\s*page|homepage|website)\b/i.test(
    value,
  ) ||
  /\bwelcome to (?:the )?.{0,80}\bwebsite\b/i.test(value);

const isSolicitationCallToActionShort = (value: string): boolean =>
  /\bif you(?:'re| are)\s+interested in participating\b/i.test(value) ||
  /\bif you(?:'re| are)\s+interested in\b[^.!?]{0,140}\b(?:please\s+(?:provide|send|submit|view|apply|contact|email|reach out)|send (?:your |an )?(?:inquiry|application|cv|cover letter)|apply\b)/i.test(
    value,
  ) ||
  /\bplease provide the following\b[^.!?]{0,80}\b(?:cover letter|curriculum vitae|\bcv\b)/i.test(value);

const isConsentBoilerplateSentence = (sentence: string): boolean =>
  /\bwe use cookies\b/i.test(sentence) ||
  (/\bcookies?\b/i.test(sentence) &&
    /\b(?:consent|experience|site traffic|traffic|preferences|opt[- ]?out|third[- ]party|personali[sz]e|tracking|analytics|browsing|settings)\b/i.test(
      sentence,
    )) ||
  /\bby (?:continuing to use|using) (?:this|our) (?:site|website)\b/i.test(sentence) ||
  /\bwe (?:use|collect|process)\b[^.!?]{0,60}\b(?:your (?:personal )?data|analytics|tracking technologies|site traffic)\b/i.test(
    sentence,
  );

const stripConsentBoilerplateSentences = (value: string): string =>
  sentenceList(value)
    .filter((sentence) => !isConsentBoilerplateSentence(sentence))
    .join(' ')
    .trim();

const isDominatedByConsentBoilerplate = (value: string): boolean =>
  sentenceList(value).some(isConsentBoilerplateSentence) &&
  wordCount(stripConsentBoilerplateSentences(value)) < 12;

const hasMalformedGeneratedText = (value: string): boolean =>
  /\bstudies\s+attack\b/i.test(value) ||
  /\band\s+and\b/i.test(value) ||
  /\b[a-z]\.\s*\),/i.test(value) ||
  /^(?:how|what|why|when|where|which|who)\b.+\?$/i.test(value) ||
  /\bgreat\s+Professor\b/i.test(value) ||
  /\busing\s+(?:develops?|studies|investigates|examines|explores|focuses|uses|employs)\b/i.test(
    value,
  ) ||
  /\busing\s+(?:and\s+)?(?:develops?|studies|investigates|examines|explores|focuses|uses|employs)\b/i.test(
    value,
  ) ||
  /\busing\b[^.!?]{0,120},\s+using\b/i.test(value);

const hasSourceNewsFragment = (value: string): boolean =>
  /^research focuses\b/.test(value) ||
  /\balleged actions reflect broader trends in statecraft\b/i.test(value) ||
  /\band\s+(?:a\s+)?yale-led study\b/i.test(value) ||
  /\b(?:read more|learn more|view full profile|related publications|continue reading)\b/i.test(value) ||
  /\bNews\s+People\s+Projects\s+Publications\s+Opportunities\s+Contact\b/i.test(value) ||
  /\b(?:see\s+)?lab permissions and copyright statement\b/i.test(value) ||
  /\bphishing alert\b/i.test(value) ||
  /\bscam and part of a phishing campaign\b/i.test(value) ||
  /\bbelow,\s+we\s+outline\s+key\s+areas\s+of\s+our\s+research\b/i.test(value) ||
  /^[A-Z]\.\s+[a-z]/.test(value) ||
  /^\s*[,.]/.test(value) ||
  /\bcon\.$/i.test(value) ||
  /\benvironme\.$/i.test(value) ||
  /\bpolicie\.$/i.test(value) ||
  /,\s*no\.?$/i.test(value) ||
  /(?:\.{3}|…)$/i.test(value) ||
  /\bjoined Yale University in\b/i.test(value) ||
  /\bjoined (?:the\s+)?Yale\b.{0,80}\bfaculty in\b/i.test(value) ||
  /\breceived (?:his|her|their)\s+(?:undergraduate|graduate|medical|doctoral)?\s*degree\b/i.test(value) ||
  /\bearned (?:his|her|their)\s+(?:undergraduate|graduate|medical|doctoral)?\s*degree\b/i.test(value) ||
  /\breceived\s+(?:[a-z'’]+\s+){0,4}degrees?\s+(?:at|from)\b/i.test(value) ||
  /\bearned\s+(?:[a-z'’]+\s+){0,4}degrees?\s+(?:at|from)\b/i.test(value) ||
  /\b(?:before\s+)?completing\s+(?:his|her|their|a|an)\s*(?:ph\.?d|doctorate|degree)\b/i.test(value) ||
  /\bpreviously,\s+(?:i|he|she|they)\s+was\b/i.test(value) ||
  /\b(?:i|he|she|they)\s+(?:received|earned|completed)\s+(?:my|his|her|their)?\s*(?:ph\.?d|doctorate|degree|sc\.?m|m\.?s|b\.?s|b\.?a)\b/i.test(value) ||
  /\bholds?\s+(?:an?\s+)?(?:[a-z'’-]+\s+){0,8}(?:degree|doctorate)\b/i.test(value) ||
  /\binternational\s+reputation\b/i.test(value) ||
  /\b(?:i|he|she|they)\s+was\s+(?:an?\s+)?[A-Za-z -]{0,60}\bFellow\b/i.test(value) ||
  /\bunder the supervision of Professor\b/i.test(value) ||
  /\bcarried out (?:his|her|their)\s+graduate work\b/i.test(value) ||
  /\bduring undergraduate\b/i.test(value) ||
  /\bstudied\s+[A-Za-z,& -]{3,120}\s+at\s+(?:the\s+)?(?:University|College|Institute|EMBL|CBM)\b/i.test(value) ||
  /\bdid (?:his|her|their)\s+(?:ph\.?d|doctorate)\b/i.test(value) ||
  /\bdid (?:his|her|their)\s+postdoctoral work\b/i.test(value) ||
  /\bpost-?doc(?:toral)? (?:work|training|fellowship)\b/i.test(value) ||
  /\bestablished (?:his|her|their)\s+laboratory at Yale in\b/i.test(value) ||
  /\bserved as (?:Senior|Associate|Assistant|Director|Dean)\b/i.test(value) ||
  /\b(?:Ph\.?D|M\.?D|D\.?)\s+from\b/i.test(value) ||
  /\bholds?\s+(?:an?\s+)?(?:secondary|joint|dual)\s+appointment\s+as\b/i.test(value);

const hasPaperFragment = (value: string): boolean =>
  /^(?:this|the)\s+(?:paper|article|chapter|book|review|preprint)\b/i.test(value) ||
  /\bin\s+this\s+(?:paper|article|chapter|review|preprint)\b/i.test(value) ||
  /\bwe\s+(?:show|prove|introduce|present|derive|explain)\b.{0,160}\b(?:paper|article|preprint)\b/i.test(value) ||
  /\bWorking\s+Paper\b/i.test(value) ||
  /\b(?:University|Press|Publisher)\b.{0,80}\((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\)/i.test(
    value,
  ) ||
  /\b(?:arxiv|doi|journal|proceedings|abstract)\b/i.test(value);

const hasResearchDescriptionVerb = (value: string): boolean =>
  /\b(studies|investigates|examines|explores|focuses on|focused on|revolves? around|works on|works towards|develops|supports|advances|fosters|innovates|uses|employs|researches|analyzes|models|measures|seeks to)\b/i.test(
    value,
  );

const hasResearchFocusPhrase = (rawValue: string): boolean => {
  const value = stripConsentBoilerplateSentences(rawValue);
  if (!value) return false;
  return (
    hasResearchDescriptionVerb(value) ||
    /\bwe\s+(?:study|investigate|examine|explore|develop|use|employ|analyze|analyse|model|measure|research|aim\s+to|seek\s+to|want\s+to\s+understand|work\s+(?:on|towards))\b/i.test(value) ||
    /\bour\s+(?:research|work|lab|group|goal|mission)\b.{0,80}\b(?:is\s+to|focuses|centers?|revolves|examines|explores|investigates|aims?|seeks?|develops?|studies|understand)\b/i.test(value) ||
    /\bI\s+study\b/i.test(value) ||
    /\b(?:research\s+and\s+teaching|teaching\s+and\s+research)\s+focus\s+on\b/i.test(value) ||
    /\binterested\s+in\b/i.test(value) ||
    /\blab['’]s\s+mission\s+is\s+to\b/i.test(value) ||
    /\bpursu(?:es|ing)\s+innovation\b/i.test(value) ||
    /\bour\s+research\s+program\s+uses\b/i.test(value) ||
    /\bour\s+lab\s+is\s+focused\s+on\b/i.test(value) ||
    /\b(?:program|group|working\s+group)['’]?\s+aims?\s+to\b/i.test(value) ||
    /\bmission\s+is\s+to\s+(?:serve|enhance|improve|advance|create|develop|support)\b/i.test(value) ||
    /\b(?:my|his|her|their|our)\s+work\s+advances\b/i.test(value) ||
    /\bresearch\s+focused\s+on\b/i.test(value) ||
    /\bresearch\s+is\s+(?:primarily\s+)?focused\s+on\b/i.test(value) ||
    /\bresearch\s+is\s+centered\s+on\b/i.test(value) ||
    /\bresearch\s+aims?\s+at\s+understanding\b/i.test(value) ||
    /\bclinical\s+research\s+includes\b/i.test(value) ||
    /\bfocus\s+on\s+the\s+clinical\s+practice\s+and\s+research\s+related\s+to\b/i.test(value) ||
    /\bresearch\s+interests?\s+include\b/i.test(value) ||
    /\bresearch(?:\s+and\s+teaching)?\s+interests?\s+(?:include|are\s+in)\b/i.test(value) ||
    /\bis\s+a\s+specialist\s+in\b/i.test(value) ||
    /\bhas\s+written\s+about\b/i.test(value) ||
    /\bhas\s+written\s+or\s+edited\b.+?\barticles\s+on\b/i.test(value) ||
    /\bexpertise\s+lies\s+in\b/i.test(value) ||
    /\bworking\s+to\s+expand\b.+?\bclinical\s+trials\b/i.test(value) ||
    /\bprimary\s+areas?\s+of\s+interest\b.+?\bteaching\s+and\s+research\b.+?:/i.test(value)
  );
};

const isIdentityOnlyLabLead = (value: string): boolean =>
  /\b(?:lab|laboratory|center|centre|program|initiative)\s+is\s+(?:an?\s+)?(?:scientific\s+)?research\s+(?:group|center|centre|program|initiative|home)\b/i.test(
    value,
  ) && !hasResearchDescriptionVerb(value);

const LOCATION_ONLY_LAB_SUBJECT_SOURCE =
  'lab|laboratory|group|center|centre|program|initiative|institute|research team|team';
const IS_LOCATED_AT_YALE_CAMPUS_RE = new RegExp(
  `\\b(?:${LOCATION_ONLY_LAB_SUBJECT_SOURCE})\\b.{0,120}\\bis\\s+located\\s+at\\b.{0,60}\\b(?:Yale|campus)\\b`,
  'i',
);

const isAffiliationOnlyLabDescription = (value: string): boolean =>
  ((/\b(?:lab|laboratory|group|center|centre|program|initiative)\b.{0,180}\bis\s+part\s+of\b/i.test(value) &&
    /\b(?:center|centre|institute|department|school|university|yale)\b/i.test(value)) ||
    IS_LOCATED_AT_YALE_CAMPUS_RE.test(value)) &&
  !hasResearchDescriptionVerb(value);

const isLocationOnlyLabDescription = (value: string): boolean =>
  IS_LOCATED_AT_YALE_CAMPUS_RE.test(value) &&
  !new RegExp(
    `\\b(?:${LOCATION_ONLY_LAB_SUBJECT_SOURCE})\\b.{0,200}\\b(?:studies|investigates|examines|explores|focuses on|works on|develops|uses|employs|researches|analyzes|models|measures|conducts research)\\b`,
    'i',
  ).test(value);

const hasSpecificResearchSeries = (value: string): boolean => {
  const text = textValue(value);
  if (!/^(?:Research\s+(?:areas?|fields)\s+include|Studies)\s+[^.]+\.$/i.test(text)) return false;
  const fieldText = text
    .replace(/^(?:Research\s+(?:areas?|fields)\s+include|Studies)\s+/i, '')
    .replace(/[.!?]+$/g, '');
  const fields = fieldText
    .split(/\s*,\s*(?:and\s+)?|\s+and\s+/i)
    .map((field) => field.trim())
    .filter((field) => field.length >= 4);
  return fields.length >= 3;
};

const isConciseSpecificResearchDescription = (value: string): boolean =>
  hasSpecificResearchSeries(value) ||
  /^Studies\s+[a-z][a-z-]+(?:\s+[a-z][a-z-]+){1,5}\.$/i.test(value) ||
  (/^(?:Research\s+(?:focuses\s+on|fields\s+include)|Studies)\b/i.test(value) &&
    /\b[a-z][a-z-]+(?:ics|ology|tion|ment|nance|theory|design|cycles)\b/i.test(value) &&
    (value.match(/,/g)?.length || 0) + (/\band\b/i.test(value) ? 1 : 0) >= 1);

/**
 * The bare label-list template flagged by #1616 (a `LAB`/`FACULTY_RESEARCH_AREA`
 * shortDescription that reads as researchAreas tags rather than a description:
 * `Studies <tag>, <tag>, and <tag>.` or `<Name>'s research fields include <tag>,
 * <tag>, and <tag>.`). Matched as a whole-sentence shape (the entire short is the
 * lead plus the list, nothing else) so a real sentence that happens to open with
 * "Studies" is never touched.
 */
const LABEL_LIST_LEAD_PATTERN = new RegExp(
  "^(?:Studies\\s+|(?:[A-Z][\\p{L}.''’-]*(?:\\s+[A-Z][\\p{L}.''’-]*)*['’]s\\s+)?[Rr]esearch\\s+(?:fields|interests|areas)\\s+include\\s+)",
  'u',
);

const LABEL_LIST_SHORT_PATTERN = new RegExp(`${LABEL_LIST_LEAD_PATTERN.source}[^.]+\\.$`, 'u');

/**
 * A list item that names an affiliation (a center, council, program, or
 * committee) rather than a research topic: you can be affiliated with a
 * Council, but you cannot "study" one (#1616, Schmidt Camacho's short serving
 * her affiliations - "the Council of Latin American and Iberian Studies" - as
 * things she researches).
 */
const LABEL_LIST_AFFILIATION_NOUN_PATTERN =
  /\b(?:Council|Committee|Consortium|Program|Programs|Institute|Foundation|Board|Initiative|Center\s+for|Centre\s+for|School\s+of|Department\s+of|Office\s+of)\b/;

function parseLabelListFields(text: string): string[] | null {
  if (!LABEL_LIST_SHORT_PATTERN.test(text)) return null;
  const lead = text.match(LABEL_LIST_LEAD_PATTERN)?.[0] ?? '';
  const body = text.slice(lead.length).replace(/[.!?]+$/g, '');
  const fields = body
    .split(/\s*,\s*(?:and\s+)?|\s+and\s+/i)
    .map((field) => field.trim())
    .filter((field) => field.length >= 3);
  return fields.length >= 2 ? fields : null;
}

/**
 * A `Studies <tags>.` / `<Name>'s research fields include <tags>.` short is
 * not a faithful compression of its own fullDescription (#1616) when there is
 * no real fullDescription prose to compress in the first place - full is
 * blank, full is itself just the same bare label-list shape, or short and
 * full are the literal same text (a short is supposed to be a distinct
 * summary, so contributing zero delta over the full is substantively empty) -
 * or when a listed item names an affiliation rather than a topic (Schmidt
 * Camacho's short serves her Council/Program affiliations as things she
 * "studies", which is incoherent - you can be affiliated with a Council, but
 * you cannot study one).
 *
 * Does NOT attempt a general topic-grounding check against the full
 * description: an approximate word-overlap comparison was tried and produces
 * real false positives on genuinely good, topically-faithful lists whose
 * wording simply does not repeat the full's exact phrasing (e.g. "Studies
 * econometrics, financial economics, ..." over a full that only says
 * "macroeconometrics" and "finance") - the same false-positive class already
 * documented against `resolveServedShortDescription`'s grounding check. A
 * short list that is topically wrong rather than structurally empty (e.g. a
 * "rock art" short over a human-evolution full) needs either a semantic check
 * or a much larger tuning corpus than this issue affords, so those are left
 * for one-off data correction rather than a general rule.
 */
function isUngroundedTopicLabelListShort(text: string, full: string): boolean {
  if (!LABEL_LIST_SHORT_PATTERN.test(text)) return false;
  if (!full || text.toLowerCase() === full.toLowerCase() || LABEL_LIST_SHORT_PATTERN.test(full)) {
    return true;
  }
  const fields = parseLabelListFields(text);
  return Boolean(fields?.some((field) => LABEL_LIST_AFFILIATION_NOUN_PATTERN.test(field)));
}

const TOPIC_LABEL_LIST_ENTITY_TYPES = new Set(['LAB', 'FACULTY_RESEARCH_AREA']);

const isTopicLabelListEligibleEntityType = (entityType: unknown): boolean =>
  typeof entityType === 'string' && TOPIC_LABEL_LIST_ENTITY_TYPES.has(entityType.toUpperCase());

const SINGLE_CLAUSE_STUDIES_SHORT_PATTERN = /^Studies\s+[^.,]{3,70}\.$/i;

const STUDIES_SHORT_STOPWORDS = new Set([
  'studies',
  'study',
  'the',
  'and',
  'from',
  'first',
  'with',
  'their',
  'using',
  'various',
  'through',
  'across',
  'between',
  'within',
  'toward',
  'towards',
  'about',
  'into',
  'that',
  'this',
  'which',
]);

const distinctiveStudiesShortTokens = (value: string): string[] =>
  Array.from(
    new Set(
      (value.toLowerCase().match(/[a-z][a-z-]{3,}/g) || [])
        .map((token) => token.replace(/-/g, ''))
        .filter((token) => token.length >= 4 && !STUDIES_SHORT_STOPWORDS.has(token)),
    ),
  );

/**
 * A single-clause "Studies <topic>." short (#1616) whose every distinctive
 * topic token is absent from the entity's own fullDescription: the clause was
 * grafted or mis-lifted from a different subject and now contradicts the real
 * description (e.g. "Studies Texas from the first." on a scholar whose full is
 * entirely about Morocco). Requires a non-empty full to contradict, requires
 * at least one distinctive token to judge, and fires only on total (zero)
 * overlap - a partial-overlap or paraphrase short is left alone, because an
 * approximate-grounding threshold produces false positives on faithful shorts
 * whose wording simply does not repeat the full verbatim (the same
 * false-positive class documented against `resolveServedShortDescription`).
 * A single-clause short that merely trivializes or cherry-picks a topic that
 * IS present in the full is not caught here - that needs a semantic check, not
 * token overlap.
 */
function isUngroundedSingleClauseStudiesShort(text: string, full: string): boolean {
  if (!full) return false;
  if (!SINGLE_CLAUSE_STUDIES_SHORT_PATTERN.test(text)) return false;
  const tokens = distinctiveStudiesShortTokens(text.replace(/^Studies\s+/i, ''));
  if (tokens.length === 0) return false;
  const normalizedFull = full.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return tokens.every((token) => !normalizedFull.includes(token));
}

const RESEARCH_AREA_CHIP_ECHO_MIN_FULL_LENGTH = 220;

const normalizeResearchAreaChipText = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function isBareResearchAreaChipEnumeration(fields: string[], researchAreas: unknown[]): boolean {
  if (fields.length < 3) return false;
  const areaSet = new Set(
    researchAreas.map((area) => normalizeResearchAreaChipText(textValue(area))).filter(Boolean),
  );
  if (areaSet.size === 0) return false;
  return fields.every((field) => areaSet.has(normalizeResearchAreaChipText(field)));
}

/**
 * The #1673-excluded residual (#1680): a LAB/FACULTY_RESEARCH_AREA short that
 * is nothing but its own researchArea chips restated in sentence form
 * (`Studies <Area>, <Area>, and <Area>.`) is faithful to a richer
 * fullDescription - so #1616's ungrounded-topic gate above correctly leaves it
 * `student_ready` - but it still wastes the card headline on a redundant
 * re-listing of the chip row already shown beside it, when a genuinely
 * distinct, compressible fullDescription is available. Detected by literal
 * membership in the entity's own `researchAreas` array (not a wording/
 * Title-Case heuristic) so a fluent short that merely resembles a list - e.g.
 * "Studies econometrics, financial economics, ..." over researchAreas that
 * don't literally contain those exact strings - is never mistaken for a chip
 * echo and swapped out.
 */
export function isReplaceableResearchAreaChipEchoShort(
  text: string,
  full: string,
  researchAreas: unknown,
  entityType: unknown,
): boolean {
  if (!isTopicLabelListEligibleEntityType(entityType)) return false;
  const fields = parseLabelListFields(text);
  if (!fields) return false;
  const areas = Array.isArray(researchAreas) ? researchAreas : [];
  if (!isBareResearchAreaChipEnumeration(fields, areas)) return false;
  if (!full || text.toLowerCase() === full.toLowerCase() || LABEL_LIST_SHORT_PATTERN.test(full)) {
    return false;
  }
  return full.length >= RESEARCH_AREA_CHIP_ECHO_MIN_FULL_LENGTH;
}

const VACUOUS_FOCUS_HEAD_NOUNS = [
  'field',
  'fields',
  'area',
  'areas',
  'subject',
  'subjects',
  'topic',
  'topics',
  'discipline',
  'disciplines',
  'domain',
  'domains',
  'system',
  'systems',
  'organism',
  'organisms',
  'problem',
  'problems',
  'question',
  'questions',
  'phenomenon',
  'phenomena',
  'process',
  'processes',
  'matter',
  'issue',
  'issues',
];

const VACUOUS_FOCUS_SUMMARY_RE = new RegExp(
  `^(?:studies|investigates|examines|explores|researches|analyzes|analyses|focuses on|works on)\\s+(?:the|a|an)\\s+(?:${VACUOUS_FOCUS_HEAD_NOUNS.join('|')})\\.?$`,
  'i',
);

export function isVacuousGenericFocusSummary(value: unknown): boolean {
  const text = textValue(value);
  if (!text) return false;
  return VACUOUS_FOCUS_SUMMARY_RE.test(text);
}

const hasFirstPersonShortLead = (value: string): boolean =>
  /^(?:we|our|my|i)\b/i.test(value) ||
  /[.!?]\s+(?:we|our|my|i)\b/i.test(value) ||
  /^(?:my|our) lab\b/i.test(value);

const hasRawGroupVoiceFullLead = (value: string): boolean =>
  /^(?:our\s+group\s+focuses|my\s+group\s+focuses)\b/i.test(value) ||
  /[.!?]\s+we\s+are\s+also\s+involved\s+in\b/i.test(value);

const hasGenericMissionStatementLead = (value: string): boolean =>
  /^(?:create and communicate|conduct high-quality|advance knowledge|develop innovative)\b/i.test(value) ||
  /^The Department (?:of [\p{L},& -]+ )?(?:also )?accomplishes its research mission\b/iu.test(value) ||
  /^The Department of Laboratory Medicine provides comprehensive\b/i.test(value);

// A scraped undergraduate-research form template that names no actual research:
// "I/We have N research projects that are focused on fabrication, measurement,
// and/or theory, depending on student interest and experience." The clause is a
// content-free recruitment placeholder shared verbatim across several physics-lab
// profiles, so it must not count as a usable source-backed description.
const isGenericStudentProjectRecruitmentTemplate = (value: string): boolean =>
  /\bresearch projects?\b.{0,40}?\bfocused on fabrication,?\s*measurement,?\s*and\/or theory,?\s*depending on student interest and experience\b/i.test(
    value,
  );

const hasFragmentaryCardCopy = (value: string): boolean =>
  /^[A-Z][a-z]+,\s+(?:the|and)\b/i.test(value) ||
  /^[\p{L}.'’-]+,\s*\d{4}\)/u.test(value) ||
  /\([^)]*$/.test(value) ||
  (/^[^()]*\)/.test(value) && !/\([^)]*\)/.test(value)) ||
  /\b[A-Z]\.$/.test(value) ||
  /^[a-z]{2,10}\/\s/.test(value);

const endsWithCardCompletionMarker = (value: string): boolean =>
  /(?:[.!?…]|\p{L}\))["'”’)\]]*$/u.test(value);

const isTruncatedCardCopy = (value: string): boolean =>
  !endsWithCardCompletionMarker(value) && !isConciseSpecificResearchDescription(value);

function hasDuplicatedLongFragment(value: string): boolean {
  const sentences = sentenceList(value)
    .map((sentence) => sentence.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((sentence) => sentence.split(/\s+/).length >= 8);
  if (new Set(sentences).size !== sentences.length) return true;

  const words = value.toLowerCase().match(/[a-z0-9]+/g) || [];
  for (let size = 10; size <= 18; size += 1) {
    const seen = new Map<string, number>();
    for (let index = 0; index <= words.length - size; index += 1) {
      const key = words.slice(index, index + size).join(' ');
      const previous = seen.get(key);
      if (previous !== undefined && index - previous >= size) return true;
      seen.set(key, index);
    }
  }
  return false;
}

const isUndergraduateResearchProgramDescription = (value: string): boolean =>
  /\b(?:supports|offers|provides|gives)\s+undergraduates?\b.{0,180}\bresearch\b/i.test(value) ||
  /\bundergraduates?\b.{0,180}\b(?:research assistantships?|research opportunities|conducting research)\b/i.test(value);

const hasLaterResearchFocusSentence = (value: string): boolean =>
  sentenceList(value)
    .slice(1)
    .some(
      (sentence) =>
        hasResearchFocusPhrase(sentence) ||
        /\bresearch\s+spans\b.+?\bfocusing\s+on\b.+/i.test(sentence) ||
        /\bresearch\s+aims?\s+at\s+understanding\b.+/i.test(sentence) ||
        /\bclinical\s+research\s+includes\b.+/i.test(sentence) ||
        /\bfocus\s+on\s+the\s+clinical\s+practice\s+and\s+research\s+related\s+to\b.+/i.test(
          sentence,
        ) ||
        /\b(?:his|her|their|my|our|[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,3}['’]s)\s+(?:primary\s+)?research(?:\s+and\s+teaching)?\s+interests?\s+(?:include|are\s+in)\b/iu.test(
          sentence,
        ) ||
        /\b(?:his|her|their|my|our|[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,3}['’]s)\s+(?:main\s+)?research\s+interests?\s+lie\s+(?:in|at)\b/iu.test(
          sentence,
        ) ||
        /\b(?:i|he|she|they)\s+(?:do|does|conducts?)\s+research\s+in\b/i.test(sentence) ||
        /\b(?:his|her|their|my|our|[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,3}['’]s)\s+research\s+is\s+centered\s+on\b/iu.test(
          sentence,
        ) ||
        /\b(?:his|her|their|my|our|[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,3}['’]s)\s+interests\s+include\b/iu.test(
          sentence,
        ) ||
        /\bresearch\s+contributions?\s+include\b/i.test(sentence) ||
        /\bresearch\s+interests?\s+include\b/i.test(sentence) ||
        /\bis\s+a\s+specialist\s+in\b/i.test(sentence) ||
        /\bhas\s+written\s+about\b/i.test(sentence) ||
        /\bhas\s+written\s+or\s+edited\b.+?\barticles\s+on\b/i.test(sentence) ||
        /\bexpertise\s+lies\s+in\b/i.test(sentence) ||
        /\bworking\s+to\s+expand\b.+?\bclinical\s+trials\b/i.test(sentence) ||
        /\bprimary\s+areas?\s+of\s+interest\b.+?\bteaching\s+and\s+research\b.+?:/i.test(
          sentence,
        ) ||
        /\bteaches(?:\s+and\s+writes)?\s+on\s+.+/i.test(sentence) ||
        /\bteaches\s+the\s+history\s+of\s+.+/i.test(sentence) ||
        /\bwriting\s+interests\s+(?:mainly\s+)?concerned\s+.+/i.test(sentence) ||
        /\bwritings\s+about\s+.+/i.test(sentence) ||
        /\bsubstantive\s+interests\s+include\s+.+/i.test(sentence) ||
        /\bscholarly\s+work\s+encompasses\b.+?\bfocusing\s+on\s+.+/i.test(sentence) ||
        /\bforemost\s+authorit(?:y|ies)\s+on\s+.+/i.test(sentence) ||
        /\bresearch-based\s+program\s+of\s+exhibitions?\s+and\s+projects\b/i.test(sentence) ||
        /\bcuratorial\s+work\s+includes\s+.+/i.test(sentence) ||
        /\b(?:interdisciplinary\s+)?scholar\s+of\s+.+/i.test(sentence) ||
        /\bcurrent\s+research\s+projects?\s+(?:include|analy[sz]e)\s+.+/i.test(sentence) ||
        /\bresearch\s+concerns\s+.+/i.test(sentence) ||
        /\bresearch\s+aimed\s+at\s+.+/i.test(sentence) ||
        /\bcurrently\s+stud(?:y|ies|ying)\s+.+/i.test(sentence) ||
        /\bpresently\s+working\s+on\s+.+/i.test(sentence) ||
        /\bCo-Principal\s+Investigator\s+on\s+a\s+grant\b.+/i.test(sentence) ||
        /\bcontributions?\s+to\s+.+/i.test(sentence),
    );

const hasExplicitProfileResearchFocus = (value: string): boolean =>
  sentenceList(value).some((sentence) =>
    /\b(?:my|his|her|their|our|[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,3}['’]s)\s+research\s+(?:examines|investigates|explores|focuses\s+on|is\s+(?:primarily\s+)?focused\s+on)\s+.+/iu.test(
      sentence,
    ) ||
      /\b(?:my|his|her|their|our|[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,3}['’]s)\s+(?:main\s+)?research\s+interests?\s+lie\s+(?:in|at)\b/iu.test(
        sentence,
      ) ||
      /\b(?:i|he|she|they)\s+(?:do|does|conducts?)\s+research\s+in\b/i.test(sentence) ||
      /\b(?:my|his|her|their|our|[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,3}['’]s)\s+research\s+is\s+centered\s+on\b/iu.test(
        sentence,
      ) ||
      /\bresearch\s+interests?\s+include\b/i.test(sentence) ||
      /\bresearch\s+aims?\s+at\s+understanding\b.+/i.test(sentence) ||
      /\bclinical\s+research\s+includes\b.+/i.test(sentence) ||
      /\bfocus\s+on\s+the\s+clinical\s+practice\s+and\s+research\s+related\s+to\b.+/i.test(
        sentence,
      ) ||
      /\bis\s+a\s+specialist\s+in\b/i.test(sentence) ||
      /\bhas\s+written\s+about\b/i.test(sentence) ||
      /\bhas\s+written\s+or\s+edited\b.+?\barticles\s+on\b/i.test(sentence) ||
      /\bexpertise\s+lies\s+in\b/i.test(sentence) ||
      /\bworking\s+to\s+expand\b.+?\bclinical\s+trials\b/i.test(sentence) ||
      /\bprimary\s+areas?\s+of\s+interest\b.+?\bteaching\s+and\s+research\b.+?:/i.test(
        sentence,
      ) ||
      /\bteaches(?:\s+and\s+writes)?\s+on\s+.+/i.test(sentence) ||
      /\bteaches\s+the\s+history\s+of\s+.+/i.test(sentence) ||
      /\bwriting\s+interests\s+(?:mainly\s+)?concerned\s+.+/i.test(sentence) ||
      /\bwritings\s+about\s+.+/i.test(sentence) ||
      /\bsubstantive\s+interests\s+include\s+.+/i.test(sentence) ||
      /\bscholarly\s+work\s+encompasses\b.+?\bfocusing\s+on\s+.+/i.test(sentence) ||
      /\bforemost\s+authorit(?:y|ies)\s+on\s+.+/i.test(sentence) ||
      /\bresearch-based\s+program\s+of\s+exhibitions?\s+and\s+projects\b/i.test(sentence) ||
      /\bcuratorial\s+work\s+includes\s+.+/i.test(sentence) ||
      /\bresearch\s+aimed\s+at\s+.+/i.test(sentence) ||
      /\bpresently\s+working\s+on\s+.+/i.test(sentence) ||
      /\bCo-Principal\s+Investigator\s+on\s+a\s+grant\b.+/i.test(sentence) ||
      /\bresearch\s+contributions?\s+include\b/i.test(sentence),
  );

const isTeachingOnlyProfileDescription = (value: string): boolean => {
  const text = textValue(value);
  if (!/\bteaches?\b/i.test(text)) return false;
  if (isUndergraduateResearchProgramDescription(text)) return false;
  if (hasResearchFocusPhrase(text)) return false;
  if (hasLaterResearchFocusSentence(text)) return false;
  if (hasExplicitProfileResearchFocus(text)) return false;

  return (
    /^Interests\b/i.test(text) ||
    /\bCourses?\b/i.test(text) ||
    /\bbefore teaching\b/i.test(text) ||
    /\bteaches?\s+(?:expository writing|undergraduate|graduate|courses?|seminars?)\b/i.test(text) ||
    /\bteaches?\s+an?\s+undergraduate\b/i.test(text)
  );
};

// Filler that a fluent synthesized full description leans on when it has no
// real source to draw from beyond the entity's own researchAreas chips: verbs
// that just announce the topic list, and generic closer nouns ("underlying
// mechanisms", "clinical implications", "these conditions") that name no
// method, model system, or finding. Distinct from `isStudiesResearchAreaEchoDescription`,
// which only matches a single bare "Studies A, B, and C." sentence that is
// fully consumed by chip text - this one is fluent, multi-sentence prose (#1625).
const AREA_ECHO_FALLBACK_STOPWORDS = new Set([
  'research',
  'studies',
  'study',
  'studying',
  'field',
  'fields',
  'interest',
  'interests',
  'area',
  'areas',
  'include',
  'includes',
  'including',
  'focus',
  'focuses',
  'focused',
  'work',
  'works',
  'with',
  'that',
  'this',
  'their',
  'from',
  'into',
  'across',
  'using',
  'based',
  'also',
  'such',
  'have',
  'related',
  'various',
  'particularly',
  'broadly',
  'generally',
  'these',
  'those',
  'about',
  'between',
  'laboratory',
  'investigates',
  'investigate',
  'investigating',
  'explores',
  'explore',
  'exploring',
  'examines',
  'examine',
  'examining',
  'understanding',
  'understand',
  'underlying',
  'mechanisms',
  'mechanism',
  'implications',
  'implication',
  'interplay',
  'conditions',
  'condition',
  'impacts',
  'impact',
  'effects',
  'effect',
  'effectiveness',
  'strategies',
  'strategy',
  'outcomes',
  'outcome',
  'connections',
  'connection',
  'connects',
  'connecting',
  'aiming',
  'aims',
  'aim',
  'improve',
  'improves',
  'improving',
  'enhance',
  'enhances',
  'enhancing',
  'address',
  'addresses',
  'addressing',
  'topics',
  'topic',
  'additionally',
  'employs',
  'employ',
  'employing',
  'utilizing',
  'utilize',
  'utilizes',
  'utilization',
  'context',
  'aspects',
  'aspect',
  'factors',
  'factor',
  'role',
  'roles',
  'processes',
  'process',
  'practices',
  'practice',
  'approaches',
  'approach',
  'clinical',
  'treatment',
  'treatments',
  'patients',
  'patient',
  'disease',
  'diseases',
  'disorder',
  'disorders',
  'management',
  'diagnosis',
  'care',
  'crisis',
  'situations',
  'situation',
  'several',
  'certain',
  'different',
  'primarily',
  'well',
  'provide',
  'providing',
  'insights',
  'insight',
  'encompasses',
  'encompass',
  'centered',
  'centers',
  'conducts',
  'conduct',
  'conducting',
]);

const AREA_ECHO_FALLBACK_MIN_EXTRA_WORDS = 4;

const areaEchoFallbackContentTokens = (value: string): Set<string> =>
  new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 4 && !AREA_ECHO_FALLBACK_STOPWORDS.has(word)),
  );

const isAreaEchoFallbackFullDescription = (value: string, researchAreas: unknown): boolean => {
  const areas = Array.isArray(researchAreas)
    ? researchAreas.filter((area): area is string => typeof area === 'string')
    : [];
  if (areas.length === 0) return false;
  const textTokens = areaEchoFallbackContentTokens(value);
  if (textTokens.size === 0) return false;
  const areaTokens = areaEchoFallbackContentTokens(areas.join(' '));
  let extra = 0;
  for (const token of textTokens) {
    if (!areaTokens.has(token)) extra += 1;
  }
  return extra < AREA_ECHO_FALLBACK_MIN_EXTRA_WORDS;
};

const isAppointmentOnly = (value: string): boolean => {
  if (isUndergraduateResearchProgramDescription(value)) return false;
  if (hasLaterResearchFocusSentence(value)) return false;
  if (hasExplicitProfileResearchFocus(value)) return false;
  return (
    isAcademicAppointmentDescription(value) ||
    /^(?:I am|I'm)\s+(?:an?\s+)?(?:assistant|associate|full|adjunct|clinical|visiting)?\s*professor\b/i.test(
      value,
    ) ||
    (!/^The\b/i.test(value) &&
      /^[A-Z].{0,180}\bis\s+(?:an?\s+|the\s+)?.{0,180}\b(?:Assistant|Associate|Full|Adjunct|Clinical|Visiting)?\s*Professor\b/i.test(value)) ||
    /\bwill be appointed as an?\s+(?:assistant|associate|full|adjunct|clinical|visiting)?\s*professor\b/i.test(
      value,
    )
  );
};

export function fullDescriptionQuality(
  value: unknown,
  researchAreas?: unknown,
): FieldQuality {
  const text = textValue(value);
  const flags: DescriptionQualityFlag[] = [];

  if (!text) flags.push('blank');
  if (text && wordCount(text) < 12 && !isConciseSpecificResearchDescription(text)) {
    flags.push('too-short');
  }
  if (
    text &&
    isStudiesResearchAreaEchoDescription(text, Array.isArray(researchAreas) ? researchAreas : null)
  ) {
    flags.push('research-area-echo');
  }
  if (text && isConnectedToKeywordListStub(text)) flags.push('research-area-echo');
  if (text && isAreaEchoFallbackFullDescription(text, researchAreas)) {
    flags.push('area-echo-fallback');
  }
  if (
    text &&
    (!/[.!?]$/.test(text) || /:\s*$/.test(text)) &&
    (text.length < 260 || /\b(?:and|or|of|in|with|for|to|the|on)$/i.test(text) || /:\s*$/.test(text))
  ) {
    flags.push('incomplete-sentence');
  }
  if (text && hasDuplicatedLongFragment(text)) flags.push('duplicated-fragment');
  if (text && hasRecruitmentBoilerplate(text)) flags.push('recruitment-boilerplate');
  if (text && isDominatedByConsentBoilerplate(text)) flags.push('consent-boilerplate');
  if (text && hasMalformedGeneratedText(text)) flags.push('malformed-generated-text');
  if (
    text &&
    hasSourceNewsFragment(text) &&
    !isConciseSpecificResearchDescription(text) &&
    !hasLaterResearchFocusSentence(text) &&
    !hasExplicitProfileResearchFocus(text) &&
    !/\bthesis\s+work\b.{0,180}\bfocused\s+on\b/i.test(text)
  ) {
    flags.push('source-news-fragment');
  }
  if (
    text &&
    hasPaperFragment(text) &&
    !isConciseSpecificResearchDescription(text) &&
    !hasLaterResearchFocusSentence(text) &&
    !hasExplicitProfileResearchFocus(text) &&
    !/\bthesis\s+work\b.{0,180}\bfocused\s+on\b/i.test(text)
  ) {
    flags.push('paper-fragment');
  }
  if (
    text &&
    isBrokenResearchEntityDescriptionFragment(text) &&
    !isConciseSpecificResearchDescription(text) &&
    !hasExplicitProfileResearchFocus(text) &&
    !/\bthesis\s+work\b.{0,180}\bfocused\s+on\b/i.test(text)
  ) {
    flags.push('source-news-fragment');
  }
  if (text && isSyntheticResearchHomeMetadataDescription(text)) flags.push('synthetic-placeholder');
  if (text && hasBrokenTemplate(text)) flags.push('broken-template');
  if (
    text &&
    isResearchEntitySourceChromeText(text) &&
    !hasExplicitProfileResearchFocus(text) &&
    !/\bresearch\s+aims?\s+at\s+understanding\b/i.test(text)
  ) {
    flags.push('profile-chrome');
  }
  if (text && (hasContactBlockResidue(text) || isCitationAuthorListDumpText(text))) {
    flags.push('profile-chrome');
  }
  if (text && isTeachingOnlyProfileDescription(text)) flags.push('profile-chrome');
  if (text && isResearchAreaPlaceholderDescription(text) && !isConciseSpecificResearchDescription(text)) {
    flags.push('research-area-placeholder');
  }
  if (text && isAppointmentOnly(text)) flags.push('appointment-only');
  if (text && isRoleOnlyTitleFragment(text)) flags.push('role-only');
  if (text && hasRawGroupVoiceFullLead(text)) flags.push('first-person');
  if (text && isAffiliationOnlyLabDescription(text)) flags.push('generic-lead');
  if (text && isLocationOnlyLabDescription(text)) flags.push('generic-lead');
  if (text && hasGenericMissionStatementLead(text)) flags.push('generic-lead');
  if (text && isGenericStudentProjectRecruitmentTemplate(text)) flags.push('generic-lead');
  if (
    text &&
    !isConciseSpecificResearchDescription(text) &&
    !publicResearchEntityDescriptionText(text) &&
    !hasExplicitProfileResearchFocus(text) &&
    !/\bresearch\s+aims?\s+at\s+understanding\b/i.test(text) &&
    !/\bthesis\s+work\b.{0,180}\bfocused\s+on\b/i.test(text)
  ) {
    if (flags.length === 0) flags.push('synthetic-placeholder');
  }

  return {
    text,
    flags: uniqueFlags(flags),
    isUseful: flags.length === 0,
  };
}

export function shortDescriptionQuality(
  value: unknown,
  fullDescription: unknown,
  researchAreas?: unknown,
  options?: { entityType?: unknown },
): FieldQuality {
  const text = textValue(value);
  const full = textValue(fullDescription);
  const fullQuality = fullDescriptionQuality(full, researchAreas);
  const firstFullSentence = textValue(sentenceList(full)[0]);
  const flags: DescriptionQualityFlag[] = [];

  if (!text) flags.push('blank');
  if (text && wordCount(text) < 8 && !isConciseSpecificResearchDescription(text)) {
    flags.push('too-short');
  }
  if (text && (text.length > 280 || wordCount(text) > 44)) flags.push('too-long');
  if (text && isSyntheticResearchHomeMetadataDescription(text)) flags.push('synthetic-placeholder');
  if (text && hasBrokenTemplate(text)) flags.push('broken-template');
  if (text && isResearchAreaTemplateLeakText(text)) flags.push('broken-template');
  if (text && hasDuplicatedLongFragment(text)) flags.push('duplicated-fragment');
  if (text && hasRecruitmentBoilerplate(text)) flags.push('recruitment-boilerplate');
  if (text && isSolicitationCallToActionShort(text)) flags.push('recruitment-boilerplate');
  if (text && isDominatedByConsentBoilerplate(text)) flags.push('consent-boilerplate');
  if (text && hasMalformedGeneratedText(text)) flags.push('malformed-generated-text');
  if (text && isStudiesTemplateGlueMalformed(text)) flags.push('malformed-generated-text');
  if (
    text &&
    isTopicLabelListEligibleEntityType(options?.entityType) &&
    isUngroundedTopicLabelListShort(text, full)
  ) {
    flags.push('topic-label-list');
  }
  if (
    text &&
    isTopicLabelListEligibleEntityType(options?.entityType) &&
    isUngroundedSingleClauseStudiesShort(text, full)
  ) {
    flags.push('ungrounded-topic-short');
  }
  if (
    text &&
    hasSourceNewsFragment(text) &&
    !isConciseSpecificResearchDescription(text) &&
    !hasLaterResearchFocusSentence(text) &&
    !hasExplicitProfileResearchFocus(text) &&
    !/\bthesis\s+work\b.{0,180}\bfocused\s+on\b/i.test(text)
  ) {
    flags.push('source-news-fragment');
  }
  if (
    text &&
    hasPaperFragment(text) &&
    !isConciseSpecificResearchDescription(text) &&
    !hasLaterResearchFocusSentence(text) &&
    !hasExplicitProfileResearchFocus(text) &&
    !/\bthesis\s+work\b.{0,180}\bfocused\s+on\b/i.test(text)
  ) {
    flags.push('paper-fragment');
  }
  if (
    text &&
    isBrokenResearchEntityDescriptionFragment(text) &&
    !isConciseSpecificResearchDescription(text) &&
    !hasExplicitProfileResearchFocus(text) &&
    !/\bthesis\s+work\b.{0,180}\bfocused\s+on\b/i.test(text)
  ) {
    flags.push('source-news-fragment');
  }
  if (text && isResearchEntitySourceChromeText(text)) flags.push('profile-chrome');
  if (text && isTeachingOnlyProfileDescription(text)) flags.push('profile-chrome');
  if (text && isResearchAreaPlaceholderDescription(text) && !isConciseSpecificResearchDescription(text)) {
    flags.push('research-area-placeholder');
  }
  if (text && isAppointmentOnly(text)) flags.push('appointment-only');
  if (text && isRoleOnlyTitleFragment(text)) flags.push('role-only');
  if (text && hasFirstPersonShortLead(text)) flags.push('first-person');
  if (text && /^my lab (?:focuses|studies|investigates|examines|works) (?:on|in|with)\b/i.test(text)) {
    flags.push('generic-lead');
  }
  if (text && isVacuousGenericFocusSummary(text)) flags.push('generic-lead');
  if (text && isIdentityOnlyLabLead(text)) flags.push('generic-lead');
  if (text && isAffiliationOnlyLabDescription(text)) flags.push('generic-lead');
  if (text && isLocationOnlyLabDescription(text)) flags.push('generic-lead');
  if (text && hasGenericMissionStatementLead(text)) flags.push('generic-lead');
  if (text && hasFragmentaryCardCopy(text)) flags.push('incomplete-sentence');
  if (text && isTruncatedCardCopy(text)) flags.push('incomplete-sentence');
  if (text && isNonSelfContainedShortDescription(text)) flags.push('non-self-contained');
  if (
    text &&
    full &&
    text.toLowerCase() === full.toLowerCase() &&
    !isConciseSpecificResearchDescription(text) &&
    (sentenceList(full).length > 1 ||
      wordCount(full) > 24 ||
      !/^(?:studies|investigates|examines|explores|supports|develops|advances|fosters|works towards|uses|employs|focuses|creative work)\b/i.test(
        text,
      ))
  ) {
    flags.push('same-as-full');
  }
  if (
    text &&
    firstFullSentence &&
    (text.toLowerCase().startsWith(`${firstFullSentence.toLowerCase()} `) ||
      (text.toLowerCase() === firstFullSentence.toLowerCase() &&
        !/^(?:studies|investigates|examines|uses|develops|focuses|creative work)\b/i.test(text))) &&
    sentenceList(full).length > 2
  ) {
    flags.push('copied-first-sentence');
  }
  if (!fullQuality.isUseful) flags.push('full-not-useful');

  return {
    text,
    flags: uniqueFlags(flags),
    isUseful: flags.length === 0,
  };
}

const PROGRAM_CARD_EXCLUSION_CLAUSE_PATTERN =
  /\b(?:will not be (?:considered|accepted|eligible)|(?:is|are) not (?:eligible|valid|permitted)|cannot be (?:for|used)|does not (?:support|cover|apply|fund))\b/i;

const PROGRAM_CARD_ADMIN_REVIEW_CLAUSE_PATTERN =
  /\b(?:applications?\s+will\s+be\s+reviewed|will\s+be\s+(?:reviewed\s+and\s+)?selected\s+by|reviewed\s+and\s+recipients\s+selected\s+by|review\s+committee\s+consisting\s+of|selected\s+by\s+(?:the|a)\s+[\p{L}\s]{0,60}\b(?:council|committee|office|board)\b)\b/iu;

const PROGRAM_CARD_LOGISTICS_CLAUSE_PATTERN =
  /\b(?:research\s+team\s+is\s+located|the\s+maximum\s+[\p{L}\s]{0,40}grant\s+is\s+\$|amounts\s+and\s+uses\s+of\s+grant|grant\s+criteria\s+and\s+guidelines|release\s+form\s+requirement|overlapping\s+grant\s+awards)\b/iu;

const isNonOfferProgramCardClause = (value: string): boolean =>
  PROGRAM_CARD_EXCLUSION_CLAUSE_PATTERN.test(value) ||
  PROGRAM_CARD_ADMIN_REVIEW_CLAUSE_PATTERN.test(value) ||
  PROGRAM_CARD_LOGISTICS_CLAUSE_PATTERN.test(value);

const PROGRAM_CARD_SELF_REFERENTIAL_LISTING_PATTERN =
  /\bis\s+listed\s+by\s+(?:the\s+)?[\p{L}][\p{L}\s]*\b/iu;

const PROGRAM_CARD_BARE_APPLICATION_ANNOUNCEMENT_ELIGIBILITY_PATTERN =
  /\b(?:from|for)\s+(?:graduate|undergraduate|current|Yale|students)\b/i;

const hasBareProgramCardApplicationAnnouncementTail = (value: string): boolean => {
  const match = value.match(/\binvites\s+applications\s+(?:to|for)\s+(?:the\s+)?(.+?)[.!?]?\s*$/i);
  if (!match) return false;
  return !PROGRAM_CARD_BARE_APPLICATION_ANNOUNCEMENT_ELIGIBILITY_PATTERN.test(match[1]);
};

/**
 * Administrative-announcement chrome (issue #1653): a sentence that only
 * names the announcing body and the award itself, with no offer/eligibility
 * content of its own - "X is listed by the Y Center" or "X invites
 * applications for the Y competition" with nothing else. Distinct from
 * `isNonOfferProgramCardClause` (#1596), which rejects an otherwise-complete
 * sentence for describing exclusions/review/logistics instead of the offer;
 * this rejects a sentence that never gets to any content at all. A sentence
 * that names an "invites applications" opener but also states who is
 * eligible (e.g. "... from graduate and undergraduate students whose
 * research focuses on ...") is left alone - it is administratively voiced
 * but not vacuous.
 */
const isProgramCardAdministrativeAnnouncementChrome = (value: string): boolean =>
  PROGRAM_CARD_SELF_REFERENTIAL_LISTING_PATTERN.test(value) ||
  hasBareProgramCardApplicationAnnouncementTail(value);

const STRAY_FOOTNOTE_MARK_PATTERN = /\*+/g;

const stripStrayFootnoteMarks = (value: string): string =>
  value.replace(STRAY_FOOTNOTE_MARK_PATTERN, '').replace(/\s{2,}/g, ' ').trim();

const STALE_ABSOLUTE_YEAR_SEASON_PATTERN =
  /\b(?:in|during)\s+the\s+(fall|winter|spring|summer)\s+of\s+(?:19|20)\d{2}\b/gi;

const relativizeStaleAbsoluteYearSeasonPhrase = (value: string): string =>
  value.replace(STALE_ABSOLUTE_YEAR_SEASON_PATTERN, 'each $1');

const normalizeProgramCardCandidateSentence = (value: string): string =>
  relativizeStaleAbsoluteYearSeasonPhrase(stripStrayFootnoteMarks(textValue(value)));

/**
 * Program-typed research entities (fellowships, RA programs) describe what
 * they offer and how to apply, not a lab-style "Studies X" research focus, so
 * the lab-oriented same-as-full/copied-first-sentence/generic-lead checks in
 * `shortDescriptionQuality` do not apply: a program's own concise, complete
 * fullDescription sentence is a legitimate card short verbatim. This keeps
 * every other safety check (blank, length, boilerplate, chrome, malformed
 * text, appointment/role-only fragments), and adds one program-specific check:
 * an exclusion clause, application-review line, or pure grant logistics
 * sentence is well-formed but tells a student nothing about what the award
 * offers, so it does not qualify as a card short either (issue #1596).
 */
export function programCardShortDescriptionQuality(
  value: unknown,
  fullDescription: unknown,
): FieldQuality {
  const text = textValue(value);
  const full = textValue(fullDescription);
  const flags: DescriptionQualityFlag[] = [];

  if (!text) flags.push('blank');
  if (text && wordCount(text) < 6) flags.push('too-short');
  if (text && (text.length > 280 || wordCount(text) > 44)) flags.push('too-long');
  if (text && isSyntheticResearchHomeMetadataDescription(text)) flags.push('synthetic-placeholder');
  if (text && hasBrokenTemplate(text)) flags.push('broken-template');
  if (text && isResearchAreaTemplateLeakText(text)) flags.push('broken-template');
  if (text && hasDuplicatedLongFragment(text)) flags.push('duplicated-fragment');
  if (text && hasRecruitmentBoilerplate(text)) flags.push('recruitment-boilerplate');
  if (text && isDominatedByConsentBoilerplate(text)) flags.push('consent-boilerplate');
  if (text && hasMalformedGeneratedText(text)) flags.push('malformed-generated-text');
  if (text && isStudiesTemplateGlueMalformed(text)) flags.push('malformed-generated-text');
  if (text && (hasContactBlockResidue(text) || isCitationAuthorListDumpText(text))) {
    flags.push('profile-chrome');
  }
  if (text && isResearchEntitySourceChromeText(text)) flags.push('profile-chrome');
  if (text && isAppointmentOnly(text)) flags.push('appointment-only');
  if (text && isRoleOnlyTitleFragment(text)) flags.push('role-only');
  if (text && hasFirstPersonShortLead(text)) flags.push('first-person');
  if (text && hasFragmentaryCardCopy(text)) flags.push('incomplete-sentence');
  if (text && isTruncatedCardCopy(text)) flags.push('incomplete-sentence');
  if (text && isNonOfferProgramCardClause(text)) flags.push('non-offer-clause');
  if (text && isProgramCardAdministrativeAnnouncementChrome(text)) flags.push('administrative-chrome');
  if (!full) flags.push('full-not-useful');

  return {
    text,
    flags: uniqueFlags(flags),
    isUseful: flags.length === 0,
  };
}

/**
 * Derives a program card short from the first self-contained sentence of its
 * fullDescription (the whole description when it is already one sentence).
 * Unlike `deriveShortDescriptionFromFullDescription`, this does not require a
 * "Studies X" lab-research framing - programs are described by what they
 * offer, not what they study (issue #1425).
 */
export function deriveProgramCardShortDescription(fullDescription: unknown): string {
  const full = textValue(fullDescription);
  if (!full) return '';
  const sentences = sentenceList(full);
  if (sentences.length === 0) return '';
  if (sentences.length === 1) {
    const candidate = normalizeProgramCardCandidateSentence(full);
    return programCardShortDescriptionQuality(candidate, full).isUseful ? candidate : '';
  }
  for (const sentence of sentences) {
    const candidate = normalizeProgramCardCandidateSentence(sentence);
    if (programCardShortDescriptionQuality(candidate, full).isUseful) return candidate;
  }
  return '';
}

export function describesResearchFocus(value: unknown): boolean {
  return hasResearchFocusPhrase(textValue(value));
}

const MAX_RESEARCH_AREA_CARD_TOPICS = 4;

const oxfordJoin = (items: string[]): string => {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
};

const ROLE_TRACK_CARD_LEAKAGE_TOPICS = new Set([
  'theorist',
  'experimentalist',
  'observational',
  'observer',
]);

/**
 * Builds a card summary from an entity's own structured `researchAreas[]` when
 * no usable summary can be grounded in its prose (issue #952: a vacuous
 * "Studies the field." beats out the clean topics that were already present).
 * Topics come from a curated structured field, so the result is gated only on
 * shape (length, non-vacuous), not on `fullDescription` grounding. Returns ''
 * when no clean topic survives so callers fail closed rather than emit filler.
 */
export function buildResearchAreasCardSummary(researchAreas: unknown): string {
  if (!Array.isArray(researchAreas)) return '';
  const topics: string[] = [];
  const seen = new Set<string>();
  for (const raw of researchAreas) {
    if (typeof raw !== 'string') continue;
    const topic = textValue(raw)
      .replace(/[.;:,]+$/g, '')
      .replace(/^(?:and|or)\s+/i, '')
      .trim();
    if (topic.length < 3 || topic.length > 60) continue;
    if (wordCount(topic) > 6) continue;
    if (/https?:\/\/|\bwww\./i.test(topic)) continue;
    const key = topic.toLowerCase();
    if (ROLE_TRACK_CARD_LEAKAGE_TOPICS.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    topics.push(topic);
    if (topics.length >= MAX_RESEARCH_AREA_CARD_TOPICS) break;
  }
  if (topics.length === 0) return '';
  const candidate = collapseDoubledConjunction(
    collapseDoubledSynthesisVerb(`Studies ${oxfordJoin(topics)}.`),
  );
  if (candidate.length > 200 || isVacuousGenericFocusSummary(candidate)) return '';
  return candidate;
}

export function assessResearchEntityDescriptionQuality(
  input: ResearchEntityDescriptionQualityInput,
): ResearchEntityDescriptionQuality {
  const full = fullDescriptionQuality(input.fullDescription, input.researchAreas);
  const short = input.isProgramLike
    ? programCardShortDescriptionQuality(input.shortDescription, input.fullDescription)
    : shortDescriptionQuality(input.shortDescription, input.fullDescription, input.researchAreas, {
        entityType: input.entityType,
      });
  // A program-like home's card is a bonus, not a requirement (it is described by
  // what it offers, not a lab-style research focus - see the invariant exemption
  // in researchEntityPublicDescription.ts): a program with no short at all is
  // still "complete" as long as its full description is useful, but a short that
  // IS present must actually clear the program card bar rather than being empty
  // template/boilerplate glue (issue #1425).
  const hasShortText = Boolean(textValue(input.shortDescription));
  const cardComplete = input.isProgramLike
    ? full.isUseful && (!hasShortText || short.isUseful)
    : full.isUseful && short.isUseful;

  return {
    full,
    short,
    sourceEligible: hasUsableSource(input),
    cardState: cardComplete ? 'complete' : 'sparse',
  };
}

function normalizeLead(sentence: string): string {
  return textValue(sentence)
    .replace(/^INFORMATION FOR\s+(?:Research Focus|Areas of Focus)\s+/i, '')
    .replace(
      /^The\s+(.+?)\s+(?:Lab|Laboratory)\s+conducts\s+research\s+focused\s+on\b/i,
      'The $1 Lab studies',
    )
    .replace(
      /^The\s+(.+?)\s+(?:Lab|Laboratory)\s+conducts\s+research\s+in\b/i,
      'The $1 Lab studies',
    )
    .replace(/^The lab conducts research focused on\b/i, 'Studies')
    .replace(/^This lab conducts research focused on\b/i, 'Studies')
    .replace(/^The lab studies\b/i, 'Studies')
    .replace(/^This lab studies\b/i, 'Studies')
    .replace(/^The laboratory studies\b/i, 'Studies')
    .replace(/^The lab investigates\b/i, 'Investigates')
    .replace(/^This lab investigates\b/i, 'Investigates')
    .replace(/^The laboratory investigates\b/i, 'Investigates')
    .replace(/^The\s+.+?\s+(?:Lab|Laboratory)(?:\s+at\s+[\p{L} .'-]+?)?(?:\s+\([^)]+\))?\s+studies\b/iu, 'Studies')
    .replace(/^In\s+the\s+.+?\s+(?:Lab|Laboratory),\s+we\s+investigate\b/i, 'Investigates')
    .replace(/^In\s+the\s+.+?\s+(?:Lab|Laboratory),\s+our\s+focus\s+of\s+research\s+is\b/i, 'Focuses on')
    .replace(/^I\s+am\s+a\s+labor\s+economist\s+who\s+studies\b/i, 'Studies')
    .replace(/^The\s+.+?\s+(?:Lab|Laboratory)(?:\s+\([^)]+\))?\s+investigates\b/i, 'Investigates')
    .replace(/^The\s+.+?\s+(?:Lab|Laboratory)(?:\s+\([^)]+\))?\s+focuses\s+on\b/i, 'Focuses on')
    .replace(/^[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}\s+(?:Lab|Laboratory)(?:\s+\([^)]+\))?\s+focuses\s+on\b/iu, 'Focuses on')
    .replace(/^The\s+.+?\s+(?:Lab|Laboratory)(?:\s+\([^)]+\))?\s+explores\b/i, 'Explores')
    .replace(/^The\s+.+?\s+(?:Program|Center|Centre|Initiative)(?:\s+.+?)?\s+investigates\b/i, 'Investigates')
    .replace(/^The\s+.+?\s+(?:Program|Center|Centre|Initiative)(?:\s+.+?)?\s+focuses\s+on\b/i, 'Focuses on')
    .replace(/^The\s+.+?\s+(?:Program|Center|Centre|Initiative)(?:\s+.+?)?\s+explores\b/i, 'Explores')
    .replace(/^The\s+.+?\s+(?:Program|Center|Centre|Initiative)(?:\s+.+?)?\s+supports\b/i, 'Supports')
    .replace(/^The\s+.+?\s+(?:Program|Center|Centre|Initiative)(?:\s+.+?)?\s+develops\b/i, 'Develops')
    .replace(/^The\s+.+?\s+(?:Program|Center|Centre|Initiative)(?:\s+.+?)?\s+advances\b/i, 'Advances')
    .replace(/^The\s+.+?\s+(?:Program|Center|Centre|Initiative)(?:\s+.+?)?\s+works\s+towards\b/i, 'Works towards')
    .replace(/^The\s+.+?\s+(?:Program|Center|Centre|Initiative)(?:\s+.+?)?\s+fosters\b/i, 'Fosters')
    .replace(/^The\s+.+?\s+(?:Program|Center|Centre|Initiative)(?:['’]s\s+mission\s+is\s+to)?\s+unite\b/i, 'Unites')
    .replace(/^The\s+(?:center|centre)\s+supports\b/i, 'Supports')
    .replace(/^The\s+(?:center|centre)\s+fosters\b/i, 'Fosters')
    .replace(/^The\s+initiative\s+advances\b/i, 'Advances')
    .replace(/^The\s+initiative\s+works\s+towards\b/i, 'Works towards')
    .replace(/^The\s+ILC\s+develops\b/i, 'Develops')
    .replace(/^Dr\.\s+[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}\s+studies\b/iu, 'Studies')
    .replace(/^The research led by\s+[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}\s+focuses\s+on\b/iu, 'Studies')
    .replace(/^[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}['’]s\s+research examines\b/iu, 'Examines')
    .replace(/^[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}['’]s\s+research focuses on\b/iu, 'Focuses on')
    .replace(/^[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}['’]s\s+research interests are in\b/iu, 'Studies')
    .replace(/^(?:My|Our)\s+research\s+and\s+teaching\s+focus\s+on\b/i, 'Studies')
    .replace(
      /^(?:His|Her|Their|[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,3}['’]s)\s+(?:research\s+and\s+teaching|teaching\s+and\s+research)\s+focus\s+on\b/iu,
      'Studies',
    )
    .replace(/^(?:His|Her|Their)\s+research\s+interests?\s+include\b/i, 'Studies')
    .replace(/^(?:His|Her|Their)\s+research\s+interests?\s+are\s+in\b/i, 'Studies')
    .replace(
      /^(?:His|Her|Their)\s+primary\s+research(?:\s+and\s+teaching)?\s+interests?\s+are\s+in\b/i,
      'Studies',
    )
    .replace(
      /^(?:His|Her|Their)\s+primary\s+research(?:\s+and\s+teaching)?\s+interests?\s+include\b/i,
      'Studies',
    )
    .replace(
      /^(?:His|Her|Their|[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,3}['’]s)\s+research\s+is\s+(?:primarily\s+)?focused\s+on\b/iu,
      'Studies',
    )
    .replace(
      /^(?:His|Her|Their)\s+Ph\.D\.\s+thesis\s+work\b.+?\bfocused\s+on\s+(?:understanding\s+)?/i,
      'Studies ',
    )
    .replace(
      /^(?:His|Her|Their|[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,3}['’]s)\s+current\s+creative\s+work\s+and\s+research\s+revolves?\s+around\b/iu,
      'Creative work spans',
    )
    .replace(/^Research focuses\s+on\s+understanding\b/i, 'Studies')
    .replace(/^Research focuses\s+on\b/i, 'Studies')
    .replace(/^Research focused\s+on\b/i, 'Studies')
    .replace(/^Research interests include\b/i, 'Studies')
    .replace(/^Research interests are in the field of\b/i, 'Studies')
    .replace(/^Research interests are in\b/i, 'Studies')
    .replace(/^In\s+my\s+work,\s+I\s+study\b/i, 'Studies')
    .replace(/^We study\b/i, 'Studies')
    .replace(/^We are interested in\b/i, 'Studies')
    .replace(/^We address questions like these with research focused on\b/i, 'Studies')
    .replace(/^Our lab['’]s mission is to build\b/i, 'Builds')
    .replace(/^We investigate\b/i, 'Investigates')
    .replace(/^We examine\b/i, 'Examines')
    .replace(/^We use\b/i, 'Uses')
    .replace(/^Our lab studies\b/i, 'Studies')
    .replace(/^Our lab focuses on\b/i, 'Studies')
    .replace(/^Our laboratory studies\b/i, 'Studies')
    .replace(/^Our group uses\b/i, 'Uses')
    .replace(/^Our group develops\b/i, 'Develops')
    .replace(/^Our group works on\b/i, 'Studies')
    .replace(/^Our group is interested in\b/i, 'Studies')
    .replace(/^Our work focuses on\b/i, 'Studies')
    .replace(/:\s+(?:how|what|why|when|where|who|which)\b[\s\S]*$/i, '.');
}

function methodPhrase(sentence: string): string {
  const text = textValue(sentence);
  const match = text.match(
    /\b(?:combine|combines|using|uses|employs|employ|applies|apply)\s+([^.!?]*(?:methods|models|experiments|studies|samples|fieldwork|archives|analysis|techniques|tethered particle motion|magnetic tweezers|single-molecule fluorescence|transcriptomics|genome editing|electrophysiology|optogenetics|microscopy|genomics|proteomics|genetics|infection models|GC-MS)[^.!?]*)/i,
  );
  if (!match) return '';
  return match[1]
    .replace(/,\s+(?:her|his|their|our|my)\s+work\b[\s\S]*$/i, '')
    .replace(/^and\s+/i, '')
    .replace(/^using\s+/i, '')
    .replace(/\s+to\s+.+$/i, '')
    .replace(/[.;:,]+$/g, '')
    .trim();
}

function primaryInterestTechnologySummary(sentences: string[]): string {
  const primaryInterest = sentences[0]?.match(/^Our primary research interest is\s+(.+?)\.?$/i);
  const technologyAim = sentences[1]?.match(
    /^At the forefront of\s+(.+?),\s+we aim to develop\s+(?:next[- ]generation\s+)?technologies\s+to\b/i,
  );
  if (!primaryInterest || !technologyAim) return '';

  const focus = primaryInterest[1].replace(/[.!?]+$/g, '').trim();
  const technologyArea = technologyAim[1].replace(/[.!?]+$/g, '').trim();
  if (!focus || !technologyArea) return '';

  const candidate = `Develops next-generation technologies for ${technologyArea}, with a focus on ${focus}.`;
  if (
    shortDescriptionQuality(candidate, sentences.join(' ')).isUseful
  ) {
    return candidate;
  }
  return '';
}

function labResearchFocusExtendsSummary(full: string): string {
  const match = full.match(
    /\blab\s+research\s+focus\s+extends\s+through\s+diverse\s+areas\s+such\s+as\s+(.+?),\s+leveraging\s+(?:our|the)\s+expertise\s+in\b/i,
  );
  if (!match?.[1] || !/\bneuroimaging\s+research\b/i.test(full)) return '';
  const focus = match[1].replace(/[.!?;:]+$/g, '').trim();
  if (!focus) return '';
  const candidate = `Studies neuroimaging across ${focus}.`;
  return shortDescriptionQuality(candidate, full).isUseful ? candidate : '';
}

function officialLabHomepageSummary(sentences: string[], full: string): string {
  for (const sentence of sentences) {
    const researchProgramUsesMatch = sentence.match(
      /\bOur\s+research\s+program\s+uses\s+(.+?),\s+a\s+technique\s+that\b.+?\b(?:enable|enables)\s+(?:the\s+)?(?:detection|study)\s+of\s+(?:the\s+)?(.+?)(?:\s+including\b|[.!?]|$)/i,
    );
    if (researchProgramUsesMatch?.[1] && researchProgramUsesMatch?.[2]) {
      const method = researchProgramUsesMatch[1].replace(/[.!?]+$/g, '').trim();
      const focus = researchProgramUsesMatch[2].replace(/[.!?]+$/g, '').trim();
      const candidate = `Uses ${method} to study ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const labFocusedOnMatch = sentence.match(
      /\bOur\s+lab\s+is\s+focused\s+on\s+(.+?)(?:\s+to\s+advance\b|\s+to\s+develop\b|[.!?]|$)/i,
    );
    if (labFocusedOnMatch?.[1]) {
      const focus = labFocusedOnMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const researchGroupFocusedMatch = sentence.match(
      /\bresearch\s+group\s+focused\s+on\s+(improving\s+.+?)(?:[.!?]|$)/i,
    );
    if (researchGroupFocusedMatch?.[1]) {
      const focus = researchGroupFocusedMatch[1]
        .replace(/^improving\b/i, 'improves')
        .replace(/[.!?]+$/g, '')
        .trim();
      const candidate = `${focus.charAt(0).toUpperCase()}${focus.slice(1)}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const seekToDecreaseMatch = sentence.match(
      /\b(?:physicians?|scientists?|researchers?)\s+who\s+seek\s+to\s+(.+?)(?:[.!?]|$)/i,
    );
    if (seekToDecreaseMatch?.[1]) {
      const focus = seekToDecreaseMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Seeks to ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const researchFueledFocusMatch = sentence.match(
      /\bOur\s+research\s+is\s+fueled\b.+?\band\s+focuses\s+on\s+(.+?)(?:[.!?]|$)/i,
    );
    if (researchFueledFocusMatch?.[1]) {
      const focus = researchFueledFocusMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const workAdvancesMatch = sentence.match(
      /\b(?:My|His|Her|Their|Our)\s+work\s+advances\s+(.+?)\s+by\s+.+?\bto\s+improve\s+(.+?)(?:[.!?]|$)/i,
    );
    if (workAdvancesMatch?.[1] && workAdvancesMatch?.[2]) {
      const focus = workAdvancesMatch[1].replace(/[.!?]+$/g, '').trim();
      const outcome = workAdvancesMatch[2].replace(/[.!?]+$/g, '').trim();
      const candidate = `Advances ${focus} to improve ${outcome}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const missionEnhanceMatch = sentence.match(
      /\b(?:our|the\s+\w+)\s+mission\s+is\s+to\s+enhance\s+(.+?)(?:[.!?]|$)/i,
    );
    if (missionEnhanceMatch?.[1]) {
      const focus = missionEnhanceMatch[1]
        .replace(/^the\s+/i, '')
        .replace(/[.!?]+$/g, '')
        .trim();
      const candidate = `Enhances ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const missionImproveMatch = sentence.match(
      /\bmission\s+is\s+to\s+serve\s+communities\s+by\s+improving\s+(.+?)(?:[.!?]|$)/i,
    );
    if (missionImproveMatch?.[1]) {
      const focus = missionImproveMatch[1].replace(/[.!?]+$/g, '').trim();
      const domain = full.match(/\b(?:collaboration|diversity|innovation|insights)\s+in\s+([^.!?]*?\bresearch)\b/i)?.[1];
      const candidate = domain
        ? `Improves ${focus} through ${domain.replace(/[.!?]+$/g, '').trim()}.`
        : `Improves ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const workingGroupAimsMatch = sentence.match(
      /\b(?:Working\s+Group|Group)\s+aims?\s+to\s+create\s+(.+?)(?:[.!?]|$)/i,
    );
    if (workingGroupAimsMatch?.[1]) {
      const focus = workingGroupAimsMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Creates ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }
  }

  return '';
}

const titleCaseResearchLabel = (value: string): string =>
  textValue(value)
    .replace(/\s+(?:All|As|These|This|Immune|However|Importantly)\b[\s\S]*$/i, '')
    .replace(/\s+/g, ' ')
    .replace(/[.;:,]+$/g, '')
    .trim();

const readableSeries = (values: string[]): string => {
  const items = values.map(titleCaseResearchLabel).filter(Boolean);
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
};

function activeAreasOfResearchSummary(full: string): string {
  if (!/\bActive areas? of research\b/i.test(full)) return '';
  const labels = Array.from(
    full.matchAll(/(?:^|\s)(?:\d+)\s*[-–]\s*([^.!?]+?)(?=(?:\s+\d+\s*[-–])|[.!?]|$)/g),
  )
    .map((match) => titleCaseResearchLabel(match[1]))
    .filter((label) => label.length >= 8)
    .slice(0, 3);
  const series = readableSeries(labels);
  if (!series) return '';
  const candidate = `Studies ${series}.`;
  return shortDescriptionQuality(candidate, full).isUseful ? candidate : '';
}

function specializationSectionSummary(full: string): string {
  const match = full.match(
    /\bSpecializations?:\s+(.+?)(?=\s+(?:About|Biography|Bio|Professional website):|$)/i,
  );
  if (!match?.[1]) return '';
  const focus = match[1].replace(/[.!?]+$/g, '').trim();
  if (!focus) return '';
  const candidate = `Studies ${focus}.`;
  return shortDescriptionQuality(candidate, full).isUseful ? candidate : '';
}

const PERSON_NAME_SUBJECT_PREDICATE =
  /^[A-Z][\p{L}.'’-]+(?:\s+[A-Z][\p{L}.'’-]+){1,3}\s+(?:specializes?|works?|holds?|held|serves?|pursues?|engages?|received|earned|joined|directs?|directed|leads?|chairs?|chaired|founds?|founded|maintains?|maintained|oversees?|oversaw|writes?|wrote|edits?|edited|teaches?|taught|studies|investigates|examines|explores|focuses|focused|develops?|researches|analyzes|models?|measures?|is|are|was|were|has|have|had)\b/u;

const startsWithPersonNameSubjectPredicate = (value: string): boolean =>
  PERSON_NAME_SUBJECT_PREDICATE.test(value);

function leadingScholarlyFieldListSummary(sentences: string[], full: string): string {
  const first = textValue(sentences[0]);
  if (!first || first.length > 140) return '';
  if (/^(?:in\s+)?(?:my|our|i|we)\b/i.test(first)) return '';
  if (!/[,\s]\b(?:especially|and|or)\b|,/.test(first)) return '';
  if (startsWithPersonNameSubjectPredicate(first)) return '';
  if (hasResearchDescriptionVerb(first) || /\b(?:is|are|was|were|has|have|had|teaches?|taught|edited|editing)\b/i.test(first)) {
    return '';
  }
  if (
    !/\b(?:Arabic|American|Asian|Black|Classical|Comparative|English|European|French|German|Greek|Hebrew|History|Humanities|Islamic|Jewish|Latin|Literature|Medieval|Modern|Music|Philosophy|Poetry|Religion|Studies|Theory)\b/i.test(
      first,
    )
  ) {
    return '';
  }
  const candidate = `Studies ${first.replace(/[.!?]+$/g, '').trim()}.`;
  return shortDescriptionQuality(candidate, full).isUseful ? candidate : '';
}

function laterResearchActivitySummary(sentences: string[], full: string): string {
  const laterResearchSentence = sentences
    .slice(1)
    .find((sentence) =>
      /\b(?:current activities are|clinical research|laboratory research|translational research|computational research|archival research|field research|research program)\b/i.test(
        sentence,
      ),
    );
  if (!laterResearchSentence) return '';

  const cleaned = textValue(laterResearchSentence)
    .replace(/^Current activities are\b/i, 'Conducts')
    .replace(/^(?:He|She|They)\s+(?:did|does|conducts?)\b/i, 'Conducts')
    .replace(/^(?:His|Her|Their)\s+current\s+activities\s+are\b/i, 'Conducts')
    .replace(/^(?:His|Her|Their)\s+clinical\s+research\s+includes\b/i, 'Studies')
    .replace(/\s+/g, ' ')
    .replace(/[.;:,]+$/g, '')
    .trim();
  const candidate = `${cleaned}.`;
  return shortDescriptionQuality(candidate, full).isUseful ? candidate : '';
}

function scholarshipFocusSummary(sentences: string[], full: string): string {
  const combined = sentences.join(' ');
  const specializationsMatch = combined.match(/\bSpecializations:\s+(.+?)(?:\s+About\b|$)/i);
  if (specializationsMatch?.[1]) {
    const focus = specializationsMatch[1].replace(/[.!?]+$/g, '').trim();
    const candidate = `Studies ${focus}.`;
    if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
  }

  const combinedResearchAimsAtUnderstandingMatch = full.match(
    /\bresearch\s+aims?\s+at\s+understanding\s+(.+?)(?:,\s+by\b|\s+by\b|[.!?]|$)/i,
  );
  if (combinedResearchAimsAtUnderstandingMatch?.[1]) {
    const focus = combinedResearchAimsAtUnderstandingMatch[1].replace(/[.!?]+$/g, '').trim();
    const candidate = `Studies ${focus}.`;
    if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
  }

  const combinedAuthoredArticlesMatch = full.match(
    /\b(?:has\s+)?authored\s+numerous\s+articles\s+on\s+(.+?)(?:,\s+such\s+as|[.!?]|$)/i,
  );
  if (combinedAuthoredArticlesMatch?.[1]) {
    const focus = combinedAuthoredArticlesMatch[1].replace(/[.!?]+$/g, '').trim();
    const candidate = `Studies ${focus}.`;
    if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
  }

  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index];
    const projectExploresWarTechnologiesMatch = sentence.match(
      /\bcurrent\s+book\s+project\b.+?\bexplores\s+how\s+(.+?),\s+from\s+.+?,\s+['"“”]?(?:perform|performs)['"“”]?\s+in\s+and\s+across\s+(.+?\baren[a-z]*)/i,
    );
    if (projectExploresWarTechnologiesMatch?.[1] && projectExploresWarTechnologiesMatch?.[2]) {
      const subject = projectExploresWarTechnologiesMatch[1].replace(/[.!?]+$/g, '').trim();
      const arena = projectExploresWarTechnologiesMatch[2].replace(/[.!?]+$/g, '').trim();
      const candidate = `Explores how ${subject} perform in ${arena}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const researchCentersOnInvestigatingMatch = sentence.match(
      /\bresearch\b.+?\bcenters\s+on\s+investigating\s+(?:a\s+variety\s+of\s+properties\s+of\s+)?(.+?)(?:[.!?]|$)/i,
    );
    if (researchCentersOnInvestigatingMatch?.[1]) {
      const focus = researchCentersOnInvestigatingMatch[1]
        .replace(/\bthe\s+interaction\s+of\s+surfaces\s+with\b/i, 'surface interactions with')
        .replace(/\binterfaces\s+between\s+solids\b/i, 'solid interfaces')
        .replace(/\bthe\s+properties\s+of\s+/i, '')
        .replace(/[.!?]+$/g, '')
        .trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const writesTeachesTraditionMatch = sentence.match(
      /\bwrites\s+and\s+teaches\s+in\s+the\s+tradition\s+of\s+(.+?),\s+emphasizing\s+(.+?)(?:[.!?]|$)/i,
    );
    if (writesTeachesTraditionMatch?.[1] && writesTeachesTraditionMatch?.[2]) {
      const tradition = writesTeachesTraditionMatch[1].replace(/[.!?]+$/g, '').trim();
      const emphasis = writesTeachesTraditionMatch[2]
        .replace(/\bemancipatory\s+strains\s+in\s+the\s+history\s+of\s+philosophy\b/i, 'philosophy')
        .replace(/\s+/g, ' ')
        .replace(/[.!?]+$/g, '')
        .trim();
      const candidate = `Studies ${tradition}, ${emphasis}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const researchTeachingFocusMatch = sentence.match(
      /\b(?:my|our|his|her|their|[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,3}['’]s)\s+(?:research\s+and\s+teaching|teaching\s+and\s+research)\s+focus\s+on\s+(.+?)(?:[.!?]$|$)/iu,
    );
    if (researchTeachingFocusMatch?.[1]) {
      const focus = researchTeachingFocusMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const primarySpecializationMatch = sentence.match(
      /\b(?:his|her|their|my|our|[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,3}['’]s)\s+primary\s+areas?\s+of\s+specialization\s+(?:is|are)\s+(.+?)(?:[.!?]|$)/iu,
    );
    if (primarySpecializationMatch?.[1]) {
      const focus = primarySpecializationMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const researchInterestIsInMatch = sentence.match(
      /\bresearch\s+interests?\s+(?:is|are)\s+in\s+(.+?)(?:\s+where\b|[.!?]|$)/i,
    );
    if (researchInterestIsInMatch?.[1]) {
      const focus = researchInterestIsInMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const researchInterestsIncludeMatch = sentence.match(
      /\bresearch\s+interests?\s+include\s+(.+?)(?:[.!?]|$)/i,
    );
    if (researchInterestsIncludeMatch?.[1]) {
      const focus = researchInterestsIncludeMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const researchAimsAtUnderstandingMatch = sentence.match(
      /\bresearch\s+aims?\s+at\s+understanding\s+(.+?)(?:,\s+by\b|\s+by\b|[.!?]|$)/i,
    );
    if (researchAimsAtUnderstandingMatch?.[1]) {
      const focus = researchAimsAtUnderstandingMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const clinicalResearchIncludesMatch = sentence.match(
      /\bclinical\s+research\s+includes\s+(.+?)(?:[.!?]|$)/i,
    );
    if (clinicalResearchIncludesMatch?.[1]) {
      const focus = clinicalResearchIncludesMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const clinicalPracticeResearchMatch = sentence.match(
      /\bfocus\s+on\s+the\s+clinical\s+practice\s+and\s+research\s+related\s+to\s+(.+?)(?:[.!?]|$)/i,
    );
    if (clinicalPracticeResearchMatch?.[1]) {
      const focus = clinicalPracticeResearchMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies clinical practice and research related to ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const specialistInMatch = sentence.match(
      /\bis\s+a\s+specialist\s+in\s+(.+?)(?:[.!?]|$)/i,
    );
    if (specialistInMatch?.[1]) {
      const focus = specialistInMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const writtenAboutMatch = sentence.match(
      /\bhas\s+written\s+about\s+(.+?)(?:[.!?]|$)/i,
    );
    if (writtenAboutMatch?.[1]) {
      const focus = writtenAboutMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const writtenEditedArticlesOnMatch = sentence.match(
      /\bhas\s+written\s+or\s+edited\b.+?\barticles\s+on\s+(.+?)(?:\s+[—-]\s+and\b|[.!?]|$)/i,
    );
    if (writtenEditedArticlesOnMatch?.[1]) {
      const focus = writtenEditedArticlesOnMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const expertiseLiesInMatch = sentence.match(
      /\bexpertise\s+lies\s+in\s+(.+?)(?:[.!?]|$)/i,
    );
    if (expertiseLiesInMatch?.[1]) {
      const focus = expertiseLiesInMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const clinicalTrialsFocusMatch = sentence.match(
      /\bworking\s+to\s+expand\b.+?\bclinical\s+trials\b.+?\bfocusing\s+on\s+(.+?)(?:[.!?]|$)/i,
    );
    if (clinicalTrialsFocusMatch?.[1]) {
      const focus = clinicalTrialsFocusMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Conducts clinical trials focusing on ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const primaryAreasDrivenResearchMatch = sentence.match(
      /\bprimary\s+areas?\s+of\s+interest\b.+?\bteaching\s+and\s+research\b.+?:\s+(.+?)(?:[.!?]|$)/i,
    );
    if (primaryAreasDrivenResearchMatch?.[1]) {
      const focus = primaryAreasDrivenResearchMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const researchInterestLieMatch = sentence.match(
      /\b(?:main\s+)?research\s+interests?\s+lie\s+(?:in|at)\s+(.+?)(?:[.!?]|$)/i,
    );
    if (researchInterestLieMatch?.[1]) {
      const focus = researchInterestLieMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const bigDataInnovationMatch = sentence.match(
      /\binnovates\s+new\s+approaches\s+to\s+the\s+analysis\s+of\s+big\s+data\s+(.+?)(?:;|[.!?]|$)/i,
    );
    if (bigDataInnovationMatch?.[1]) {
      const scope = bigDataInnovationMatch[1].replace(/[.!?;]+$/g, '').trim();
      const candidate = `Innovates new approaches to the analysis of big data ${scope}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const researchCenteredOnMatch = sentence.match(
      /\b(?:my|his|her|their|our|[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,3}['’]s)\s+research\s+is\s+centered\s+on\s+(.+?)(?:,\s+integrating\b|[.!?]|$)/iu,
    );
    if (researchCenteredOnMatch?.[1]) {
      const focus = researchCenteredOnMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const interestsIncludeMatch = sentence.match(
      /\b(?:his|her|their|my|our|[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,3}['’]s)\s+interests\s+include\s+(.+?)(?:[.!?]|$)/iu,
    );
    if (interestsIncludeMatch?.[1]) {
      const focus = interestsIncludeMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const studiesFocusingOnMatch = sentence.match(
      /\b(?:he|she|they|[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,3})\s+studies\s+(.+?),\s+focusing\s+on\s+(.+?)(?:[.!?]|$)/iu,
    );
    if (studiesFocusingOnMatch?.[1] && studiesFocusingOnMatch?.[2]) {
      const field = studiesFocusingOnMatch[1].replace(/[.!?]+$/g, '').trim();
      const focus = studiesFocusingOnMatch[2].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${field}, focusing on ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const doesResearchInMatch = sentence.match(
      /\b(?:i|he|she|they)\s+(?:do|does|conducts?)\s+research\s+in\s+(.+?)(?:[.!?]|$)/i,
    );
    if (doesResearchInMatch?.[1]) {
      const focus = doesResearchInMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const researchExaminesMatch = sentence.match(
      /\b(?:my|his|her|their|our|[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,3}['’]s)\s+research\s+examines\s+(.+?)(?:[.!?]|$)/iu,
    );
    if (researchExaminesMatch?.[1]) {
      const focus = researchExaminesMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Examines ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const teachesAndWritesMatch = sentence.match(
      /\bteaches\s+and\s+writes\s+on\s+(.+?)(?:[.!?]|$)/i,
    );
    if (teachesAndWritesMatch?.[1]) {
      const focus = teachesAndWritesMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const teachesHistoryMatch = sentence.match(
      /\bteaches\s+the\s+history\s+of\s+(.+?)(?:\s+and\s+directs\b|[.!?]|$)/i,
    );
    if (teachesHistoryMatch?.[1]) {
      const focus = teachesHistoryMatch[1].replace(/[.!?]+$/g, '').trim();
      const nextFocus = sentence.match(/\bdirects\s+.+?Center\s+for\s+the\s+Study\s+of\s+(.+?)(?:[.!?]|$)/i)?.[1];
      const candidate = nextFocus
        ? `Studies ${focus} and ${nextFocus.replace(/[.!?]+$/g, '').trim()}.`
        : `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const writingInterestsMatch = sentence.match(
      /\bwriting\s+interests\s+(?:mainly\s+)?concerned\s+(.+?)(?:[.!?]|$)/i,
    );
    if (writingInterestsMatch?.[1]) {
      const focus = writingInterestsMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const writingsAboutMatch = sentence.match(/\bwritings\s+about\s+(.+?)(?:[.!?]|$)/i);
    if (writingsAboutMatch?.[1]) {
      const focus = writingsAboutMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const substantiveInterestsMatch = sentence.match(
      /\bsubstantive\s+interests\s+include\s+(.+?)(?:[.!?]|$)/i,
    );
    if (substantiveInterestsMatch?.[1]) {
      const focus = substantiveInterestsMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const scholarlyWorkEncompassesMatch = sentence.match(
      /\bscholarly\s+work\s+encompasses\b.+?\bfocusing\s+on\s+(.+?)(?:[.!?]|$)/i,
    );
    if (scholarlyWorkEncompassesMatch?.[1]) {
      const focus = scholarlyWorkEncompassesMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const foremostAuthorityMatch = sentence.match(
      /\bforemost\s+authorit(?:y|ies)\s+on\s+(.+?)(?:[.!?]|$)/i,
    );
    if (foremostAuthorityMatch?.[1]) {
      const focus = foremostAuthorityMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const researchBasedCuratorialMatch = sentence.match(
      /\bresearch-based\s+program\s+of\s+(.+?)(?:[.!?]|$)/i,
    );
    if (researchBasedCuratorialMatch?.[1]) {
      const focus = researchBasedCuratorialMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Creative work spans curatorial practice, research-based ${focus}, and contemporary art.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const currentlyWorkingOnMatch = sentence.match(
      /\b(?:is|are|am|was|were|be|been|being|currently)\s+currently\s+working\s+on\s+(.+?)(?:[.!?]|$)|\bcurrently\s+working\s+on\s+(.+?)(?:[.!?]|$)|\bpresently\s+working\s+on\s+(?:several\s+projects?:\s+)?(.+?)(?:[.!?]|$)/i,
    );
    const currentlyWorkingFocus =
      currentlyWorkingOnMatch?.[1] || currentlyWorkingOnMatch?.[2] || currentlyWorkingOnMatch?.[3];
    if (currentlyWorkingFocus) {
      const focus = currentlyWorkingFocus.replace(/[.!?]+$/g, '').trim();
      const candidate = `Works on ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const collaborationProjectMatch = sentence.match(
      /\binvolved\s+in\s+a\s+collaboration\s+on\s+(.+?\bproject\b.+?)(?:[.!?]|$)/i,
    );
    if (collaborationProjectMatch?.[1]) {
      const focus = collaborationProjectMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Works on ${focus} through collaboration.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const researchAimedAtMatch = sentence.match(/\bresearch\s+aimed\s+at\s+(.+?)(?:[.!?]|$)/i);
    if (researchAimedAtMatch?.[1]) {
      const focus = researchAimedAtMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const quotedGrantMatch = sentence.match(
      new RegExp(
        String.raw`\bCo-Principal\s+Investigator\s+on\s+a\s+grant\b.+?[(\"'“‘]([^)\"'”’]+)[)\"'”’]`,
        'i',
      ),
    );
    const unquotedGrantMatch = sentence.match(
      /\bCo-Principal\s+Investigator\s+on\s+a\s+grant\b.+?,\s+(.+?)(?:[.!?]|$)/i,
    );
    const coPrincipalGrantFocus = quotedGrantMatch?.[1] || unquotedGrantMatch?.[1];
    if (coPrincipalGrantFocus) {
      const focus = coPrincipalGrantFocus.replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const currentlyStudyingMatch = sentence.match(
      /\bcurrently\s+stud(?:y|ies|ying)\s+(.+?)(?:,\s+with\s+the\s+goal\b|[.!?]|$)/i,
    );
    if (currentlyStudyingMatch?.[1]) {
      const focus = currentlyStudyingMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const conductingTrialsMatch = sentence.match(
      /\b(?:we\s+are\s+)?conducting\s+(.+?\b(?:RCTs?|clinical\s+trials?|trials?)\b.+?)(?:[.!?]|$)/i,
    );
    if (conductingTrialsMatch?.[1]) {
      const focus = conductingTrialsMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Conducts ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const studyOfMatch = sentence.match(
      /\b(?:a\s+)?(?:study|history)\s+of\s+(.+?)(?:[.!?]|$)/i,
    );
    if (studyOfMatch?.[1]) {
      const focus = studyOfMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const scholarOfMatch = sentence.match(
      /\b(?:is\s+)?(?:an?\s+)?(?:interdisciplinary\s+)?scholar\s+of\s+(.+?)(?:[.!?]|$)/i,
    );
    if (scholarOfMatch?.[1]) {
      const focus = scholarOfMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const researchProjectsMatch = sentence.match(
      /\bcurrent\s+research\s+projects?\s+(?:include|analy[sz]e)\s+(.+?)(?:[.!?]|$)/i,
    );
    if (researchProjectsMatch?.[1]) {
      const focus = researchProjectsMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const researchConcernsMatch = sentence.match(
      /\bresearch\s+concerns\s+(.+?)(?:[.!?]|$)/i,
    );
    if (researchConcernsMatch?.[1]) {
      const focus = researchConcernsMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const researchSpansFocusingMatch = sentence.match(
      /\bresearch\s+spans\b.+?\bfocusing\s+on\s+(.+?)(?:[.!?]|$)/i,
    );
    if (researchSpansFocusingMatch?.[1]) {
      const focus = researchSpansFocusingMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const contributionsMatch = sentence.match(
      /\bcontributions?\s+to\s+(.+?)(?:[.!?]|$)/i,
    );
    if (contributionsMatch?.[1]) {
      const focus = contributionsMatch[1].replace(/[.!?]+$/g, '').trim();
      const nextFocus = sentences[index + 1]?.match(
        /\b(?:reform|study|analysis)\s+of\s+(.+?)(?:[.!?]|$)/i,
      )?.[1];
      const candidate = nextFocus
        ? `Studies ${focus} and ${nextFocus.replace(/[.!?]+$/g, '').trim()} reform.`
        : `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const researchContributionsMatch = sentence.match(
      /\bresearch\s+contributions?\s+include\s+(.+?)(?:[.!?]|$)/i,
    );
    if (researchContributionsMatch?.[1]) {
      const focus = researchContributionsMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const authoredArticlesMatch = sentence.match(
      /\b(?:has\s+)?authored\s+numerous\s+articles\s+on\s+(.+?)(?:,\s+such\s+as|[.!?]|$)/i,
    );
    if (authoredArticlesMatch?.[1]) {
      const focus = authoredArticlesMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const elucidatingStepsMatch = sentence.match(
      /\bbegan\s+elucidating\s+the\s+steps\s+leading\s+from\s+(.+?)\s+to\s+(.+?)(?:[.!?]|$)/i,
    );
    if (elucidatingStepsMatch?.[1] && elucidatingStepsMatch?.[2]) {
      const from = elucidatingStepsMatch[1].replace(/[.!?]+$/g, '').trim();
      const to = elucidatingStepsMatch[2].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies steps leading from ${from} to ${to}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

  }

  if (
    /\bmany\s+other\s+plays,\s+which\s+include\b/i.test(combined) &&
    /\b(?:screenplays?|teleplays?|pilots?)\b/i.test(combined)
  ) {
    const candidate = 'Creative work spans playwriting, theater, screenwriting, and dramatic storytelling.';
    if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
  }

  const combinedStudyOfMatch = combined.match(
    /\b(?:a\s+)?(?:study|history)\s+of\s+(.+?)(?:[.!?]|$)/i,
  );
  if (combinedStudyOfMatch?.[1]) {
    const focus = combinedStudyOfMatch[1].replace(/[.!?]+$/g, '').trim();
    const candidate = `Studies ${focus}.`;
    if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
  }

  return '';
}

export function deriveShortDescriptionFromFullDescription(fullDescription: unknown): string {
  const full = textValue(fullDescription);
  const fullQuality = fullDescriptionQuality(full);
  const onlyFirstPersonFull =
    fullQuality.flags.length === 1 && fullQuality.flags.includes('first-person');
  if (!fullQuality.isUseful && !onlyFirstPersonFull) return '';
  if (isConciseSpecificResearchDescription(full)) return full;
  const sentences = sentenceList(full);
  if (sentences.length === 0) return '';

  const primaryInterestSummary = primaryInterestTechnologySummary(sentences);
  if (primaryInterestSummary) return primaryInterestSummary;

  const combinedFull = sentences.join(' ');

  const labResearchFocusSummary = labResearchFocusExtendsSummary(combinedFull);
  if (labResearchFocusSummary) return labResearchFocusSummary;

  const labHomepageSummary = officialLabHomepageSummary(sentences, full);
  if (labHomepageSummary) return labHomepageSummary;

  const specializationSummary = specializationSectionSummary(full);
  if (specializationSummary) return specializationSummary;

  const activeAreasSummary = activeAreasOfResearchSummary(combinedFull);
  if (activeAreasSummary) return activeAreasSummary;

  const leadingFieldListSummary = leadingScholarlyFieldListSummary(sentences, full);
  if (leadingFieldListSummary) return leadingFieldListSummary;

  if (
    /\bmany\s+other\s+plays,\s+which\s+include\b/i.test(full) &&
    /\b(?:screenplays?|teleplays?|pilots?)\b/i.test(full)
  ) {
    const candidate = 'Creative work spans playwriting, theater, screenwriting, and dramatic storytelling.';
    if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
  }

  const laterActivitySummary = laterResearchActivitySummary(sentences, full);
  if (laterActivitySummary) return laterActivitySummary;

  const scholarshipSummary = scholarshipFocusSummary(sentences, full);
  if (scholarshipSummary) return scholarshipSummary;

  const researchStreamsMatch = combinedFull.match(
    /^Research focuses on two related research streams\.\s+(Combines\s+.+?)(?:[.!?]|$)/i,
  );
  if (researchStreamsMatch) {
    const candidate = `${researchStreamsMatch[1].replace(/[.!?]+$/g, '').trim()}.`;
    if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
  }

  const fieldsAndInterestsMatch = combinedFull.match(
    /^Research focuses on\s+(.+?)\.\s+Research interests include\s+(.+?)(?:[.!?]|$)/i,
  );
  if (fieldsAndInterestsMatch) {
    const fields = fieldsAndInterestsMatch[1].replace(/[.!?]+$/g, '').trim();
    const interests = fieldsAndInterestsMatch[2].replace(/[.!?]+$/g, '').trim();
    const candidate = `Studies ${fields}, including ${interests}.`;
    if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
  }

  const fieldsAndIssueStudiesMatch = combinedFull.match(
    /^Research focuses on\s+(.+?)\.\s+(Studies\s+issues\s+related\s+to\s+.+?)(?:[.!?]|$)/i,
  );
  if (fieldsAndIssueStudiesMatch) {
    const candidate = `${fieldsAndIssueStudiesMatch[2].replace(/[.!?]+$/g, '').trim()}.`;
    if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
  }

  const humanitiesCenterMatch = combinedFull.match(
    /\b(?:It[’']s|It is)\s+a center of gravity for the many orbits of\s+(.+?)\s+that make up the humanities at Yale University\b/i,
  );
  if (humanitiesCenterMatch) {
    const focus = humanitiesCenterMatch[1].replace(/[.!?]+$/g, '').trim();
    const candidate = `Supports ${focus} in the humanities at Yale University.`;
    if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
  }

  const combinesToUnderstandMatch = combinedFull.match(
    /^Combines\s+(.+?)\s+to understand\s+(.+?)(?:[.!?]|$)/i,
  );
  if (combinesToUnderstandMatch) {
    const method = combinesToUnderstandMatch[1].replace(/[.!?]+$/g, '').trim();
    const focus = combinesToUnderstandMatch[2].replace(/[.!?]+$/g, '').trim();
    const candidate = `Studies ${focus} by combining ${method}.`;
    if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
  }

  const socialGroupsAcquiredMatch = combinedFull.match(
    /\b(?:My|Our)\s+lab\s+addresses\s+this\s+question\s+by\s+studying\s+how\s+knowledge\s+of\s+social\s+groups\s+is\s+acquired\b/i,
  );
  if (socialGroupsAcquiredMatch) {
    const candidate = 'Studies how knowledge of social groups is acquired in adults and children.';
    if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
  }

  const dedicatedAdvancingMatch = combinedFull.match(
    /^Our\s+lab\s+is\s+dedicated\s+to\s+advancing\s+(.+?)\s+through\s+the\s+development\s+of\s+(.+?)(?:\s+across\s+[^.!?]+)?(?:[.!?]|$)/i,
  );
  if (dedicatedAdvancingMatch) {
    const focus = dedicatedAdvancingMatch[1].replace(/[.!?]+$/g, '').trim();
    const outputs = dedicatedAdvancingMatch[2].replace(/[.!?]+$/g, '').trim();
    const candidate = `Develops ${outputs} for ${focus}.`;
    if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
  }

  const leadSentence = isIdentityOnlyLabLead(sentences[0])
    ? sentences.find((sentence, index) => index > 0 && !isIdentityOnlyLabLead(sentence)) ||
      sentences[0]
    : sentences[0];
  const researchFocusSentence =
    !hasResearchFocusPhrase(leadSentence) ||
    /^(?:one of the grand challenges|a frontier of this understanding|the discovery and development)/i.test(
      leadSentence,
    )
      ? sentences.find((sentence, index) =>
          index > 0 &&
          (/\b(?:our group|the lab|the group)\s+(?:uses|develops|studies|investigates|explores|focuses|is interested|works on)\b/i.test(
            sentence,
          ) ||
            hasResearchFocusPhrase(sentence)),
        ) || leadSentence
      : leadSentence;
  const lead = normalizeLead(researchFocusSentence);
  const method = methodPhrase(sentences.filter((sentence) => sentence !== researchFocusSentence).join(' '));
  if (method && !new RegExp(method.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(lead)) {
    const candidate = `${lead.replace(/[.!?]+$/g, '')}, using ${method}.`;
    if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
  }
  return shortDescriptionQuality(lead, full).isUseful ? lead : '';
}
