import { isCareerFactSentence, researchStatementSentences } from './careerBiographyDescription';
import { revoiceFirstPersonResearchLead } from './researchEntityDescriptionText';
import { fullDescriptionQuality } from './researchEntityDescriptionQuality';

export type BioResearchStatementRejection =
  'empty_bio' | 'no_research_statement' | 'only_past_research' | 'not_useful_after_filtering';

export interface BioResearchStatement {
  fullDescription: string;
  sentences: string[];
  /** The qualifying bio sentences as written, before revoicing: the writer's evidence. */
  evidenceSentences: string[];
  rejection?: BioResearchStatementRejection;
}

const FIRST_PERSON_PAST_RESEARCH =
  /^\s*(?:I|We)\s+(?:\w+ly\s+)?(?:focused|studied|investigated|worked|examined|explored|researched)\b/i;

const PAST_RESEARCH_SENTENCE =
  /\b(?:was|were|had\s+been|previously|formerly|directed|led|founded|established|for\s+(?:over|more\s+than|nearly|almost)\s+(?:\d+|[a-z]+(?:-[a-z]+)?)\s+years|earlier\s+in\s+(?:his|her|their)\s+career|doctoral|dissertation|thesis|post-?doctoral|as\s+an?\s+(?:graduate|doctoral|ph\.?\s?d\.?|undergraduate|medical)\s+student|during\s+(?:his|her|their)\s+(?:ph\.?\s?d|doctoral|graduate|postdoctoral|residency|fellowship))\b/i;

export const CLINICAL_SERVICE_FOCUS =
  /\b(?:focus(?:es|ed)?\s+on\s+(?:the\s+)?(?:surgical|medical|clinical|operative|non-?operative|comprehensive)?\s*(?:treatment|care|management|evaluation)\s+of\s+(?:patients|adults|children|women|men|people)|speciali[sz](?:es|ing)\s+in\s+(?:the\s+)?(?:surgical\s+|medical\s+|clinical\s+|minimally\s+invasive\s+)?(?:treatment|care|management|diagnosis|evaluation)\s+of)\b/i;

export const CLINICAL_SPECIALTY_SENTENCE =
  /\bspeciali[sz](?:es|ing|ed)?\s+in\b|\b(?:primary\s+)?focus\s+is\s+(?:on\s+)?clinical\s+care\b|\bperforming\b[^.]{0,80}\bsurger(?:y|ies)\b/i;

export const SCHOLARLY_INQUIRY =
  /\b(?:research|stud(?:y|ies|ying)|investigat\w*|scholar\w*|analy[sz]\w*|theor\w*)\b/i;

const NON_RESEARCH_ONLY_SENTENCE =
  /\b(?:teach(?:es|ing)?|courses?|curricul|sees\s+patients|clinical\s+(?:practice|care|service)|board[- ]certified|practices\s+(?:general|internal|family)|patient\s+care)\b/i;

const NOT_RESEARCH_CONTENT_SENTENCE =
  /\b(?:boards?\s+of|serves?\s+on|served|editor|editorial|reviewer|committee|council|task\s+force|president|co-?founder|founded|managing\s+partner|venture|funded\s+by|has\s+been\s+funded|grants?\s+from|book|forthcoming|to\s+appear|published\s+by|translations?|selected\s+publications|publications?\s*:|co-?edited|google\s+scholar|can\s+be\s+found|click|blogs?|website|administrative\s+roles?|appointment\s+as|private\s+practice|co-?authors?\s+of|co-?authored|has\s+appeared\s+in|appeared\s+in|appears\s+in|edited\s+by|in\s+press|new\s+york\s+times|washington\s+post|wall\s+street\s+journal|the\s+atlantic|npr\b|(?:his|her|their)\s+practice|clinical\s+expertise|board[- ]certified|holds\s+an?\s+(?:MSc|MA|MS|BA|BS|PhD|MD)|studied\s+medicine|completed|graduated|has\s+joined|joined\s+the|enthusiasm\s+for|received\s+(?:his|her|their)|trained)\b/i;

const CLINICAL_SERVICE_SHAPES = [
  /\b(?:special|particular)\s+interests?\s+(?:is\s+|are\s+)?in\b/i,
  /\bclinical\s+(?:interests?|focus|expertise|specialt(?:y|ies))\s+(?:include|includes|are|is|lies?|focus(?:es)?)\b/i,
  /\b(?:provid(?:e|es|ed|ing)|deliver(?:s|ed|ing)?|offer(?:s|ed|ing)?)\b[^.]{0,80}\bcare\b/i,
  /\b(?:provid(?:e|es|ed|ing)|deliver(?:s|ed|ing)?|offer(?:s|ed|ing)?)\s+patients\b/i,
  /\badvancing\s+[\w\s-]{0,40}\bcare\b/i,
  /\bsupporting\s+patients\b/i,
  /\b(?:caring|cares)\s+for\b/i,
  /\bcare\s+for\s+patients\b/i,
  /\binterests?\s+include\s+(?:treating|managing|caring)\b/i,
  /\binterested\s+in\s+the\s+(?:management|treatment|care)\s+of\b/i,
  /\b(?:treats|treating)\s+patients\b/i,
  /\bworks?\s+with\s+patients\s+to\b/i,
  /\beach\s+patient(?:['’]s)?\b/i,
  /\bhelp(?:s|ing)?\s+(?:each\s+)?(?:patients?|famil(?:y|ies))\b/i,
  /\bpartnering\s+with\s+patients\b/i,
  /\bgetting\s+patients\s+back\b/i,
];

const NOT_AFTER_ANOTHER_CARE_GIVER =
  '(?<!\\b(?:clinicians|physicians|providers|caregivers|doctors|nurses|surgeons|practitioners|teams|clinics|hospitals)\\s+(?:to\\s+)?)';

const PATIENT_SERVICE_PURPOSE = new RegExp(
  `${NOT_AFTER_ANOTHER_CARE_GIVER}\\b(?:help|helps|helping|serve|serves|serving|benefit|benefits)\\s+(?:his|her|their)\\s+(?:own\\s+)?patients\\b`,
  'i',
);

const PATIENT_SERVICE_SHAPES = [
  new RegExp(
    `${NOT_AFTER_ANOTHER_CARE_GIVER}\\b(?:treat(?:s|ing)?|cares?\\s+for|caring\\s+for|sees|seeing|provid(?:e|es|ed|ing)\\s+care\\s+(?:to|for)|help(?:s|ing)?|serv(?:e|es|ing))\\s+(?:all\\s+)?(?:his|her|their)\\s+(?:own\\s+)?patients\\b`,
    'i',
  ),
  /\b(?:combat\w*|treat(?:s|ing)?|alleviat\w*|reliev\w*)\s+(?:the\s+)?symptoms\b/i,
];

const CLINICAL_VOCABULARY =
  /\b(?:patients?|care|clinical(?:ly)?|clinicians?|medical|medicine|disorders?|diseases?|conditions?|syndromes?|symptoms?|treatment|therap(?:y|ies)|diagnos\w*|surg(?:ery|eries|ical)|nutrition|pain|injur(?:y|ies)|infections?|cancers?|tumou?rs?|neurological|psychiatric|mental\s+health|pregnanc(?:y|ies)|asthma|allerg(?:y|ies)|dermatolog\w*|cardiolog\w*|skin|nerves?|spin(?:e|al)|stimulation|anesthe\w*|procedures?|trauma)\b/i;

const STATES_INQUIRY =
  /\b(?:research\w*|lab(?:s|oratory|oratories)?|stud(?:y|ies|ying|ied)|investigat\w*|trials?|scien\w*|scholar\w*|examin\w*|explor\w*|analy[sz]\w*|evaluat\w*|measur\w*|experiment\w*|discover\w*|mechanisms?|data|cohorts?|outcomes|epidemiolog\w*|biomarkers?|interventions?|understand(?:ing)?\s+(?:the|how|why|what|whether)|how|technolog\w*|informatics|quality\s+of\s+care|health\s+services|disparit(?:y|ies)|\w*ethic(?:s|al)|model(?:ing|ling)|(?:computational|statistical|mathematical|animal|mouse|murine|predictive)\s+models?|biolog\w*|genes?|genetic\w*|genomic\w*|why|whether|engineer\w*|benchmark\w*|machine\s+learning|build(?:s|ing)?|detect\w*|software|robot\w*|sensors?|wearables?|devices?|survey\w*|assess\w*|pilot(?:s|ing|ed)?|prob(?:e|es|ing)|imaging|estimat\w*|registr(?:y|ies)|track(?:s|ing)|characteri[sz]\w*|quantif\w*|randomi[sz]\w*|predict\w*|catalog\w*|correlat\w*|compar(?:e|es|ing|ison|isons)|algorithms?|sequenc(?:e|es|ing)|(?:co-)?design(?:s|ing|ed)?|map(?:s|ping)?\s+(?:the|how|which|where)|improv(?:e|es|ing)\s+(?:the\s+)?(?:[\w-]+\s+){0,2}care|immunolog\w*|pharmacolog\w*|pathogenesis|microbiome|circuits?|prevention|screening|polic(?:y|ies)|decision[-\s]making|safety|implementation|develop\w*\s+(?:and\s+test\s+)?(?:new\s+|novel\s+)?(?:[\w-]+\s+){0,2}(?:tools?|devices?|sensors?|therap\w*|methods?|models?|algorithms?|interventions?|measures?|assays?|drugs?|vaccines?|gene)|test(?:s|ing)?\b)\b/i;

const CREATIVE_PRACTICE =
  /\b(?:music\w*|compos(?:e|es|er|ers|ing|ition|itions)|choreograph\w*|danc(?:e|es|er|ers|ing)|plays?|playwright\w*|theat(?:er|re)\w*|performance\s+art|performers?|artists?|artwork|paint\w*|sculpt\w*|poe(?:t|ts|try|ms?)|fiction|novels?|writ(?:e|es|ing)\s+(?:plays|poems|fiction|novels|music)|film\w*|photograph\w*|portrait\w*|documentar\w*|opera|songs?|lullab\w*|murals?|memoirs?|essays?|textiles?|installations?|comed(?:y|ies|ian|ians)|stand-up)\b/i;

export function isClinicalOnlyBiographySentence(sentence: string): boolean {
  if (CREATIVE_PRACTICE.test(sentence)) return false;
  return (
    [...CLINICAL_SERVICE_SHAPES, ...PATIENT_SERVICE_SHAPES, PATIENT_SERVICE_PURPOSE].some((shape) =>
      shape.test(sentence),
    ) &&
    CLINICAL_VOCABULARY.test(sentence) &&
    !STATES_INQUIRY.test(sentence)
  );
}

const CITATION_FRAGMENT =
  /\beds?\.(?=[\s,)])|\((?:eds?|ed)\.?\)|\b\d+\s*\(\d+\)\s*[:,]|\bpp\.\s*\d|\bvol\.\s*\d|[“"][^”"]{8,}[”"]\s*,?\s*in\s+[A-Z]/;

const DANGLING_REFERENCE_OPENER =
  /^(?:The\s+latter|The\s+former|These|This\s+(?:work|book|project|volume))\b/;

export const RESEARCH_WORD =
  /\b(?:research|stud(?:y|ies|ying)|investigat|examin|explor|analy[sz]|model|develop|focus|interests?)\w*/i;

const PERSON_RESEARCH_SUBJECT =
  /^(?:(?:Most\s+recently|More\s+recently|Recently|Currently|Today|In\s+addition|Additionally),?\s+)?(?:(?:His|Her|Their|Dr\.?\s+[A-Z][\p{L}'’-]+['’]s|[A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’.-]+){0,2}['’]s)\s+)((?:(?:current|primary|main|principal|recent|ongoing|academic)\s+)?(?:research|scholarship|work|lab|laboratory|group))/u;

const PERSON_PRONOUN_VERB =
  /^(?:(?:Currently|Today|Additionally|In\s+addition),?\s+)?(?:He|She|They|Dr\.?\s+[A-Z][\p{L}'’-]+)\s+(?:(?:also|currently|primarily|mainly)\s+)?((?:studies|investigates|examines|explores|analy[sz]es|evaluates|models|develops|focuses|works\s+on|speciali[sz]es\s+in|uses|leads|directs)\b)/u;

const capitalize = (value: string): string =>
  value ? value.charAt(0).toUpperCase() + value.slice(1) : value;

/**
 * Restates a biography sentence about the person's own research without the person
 * as its grammatical subject, so the derived body reads as a description of the
 * research rather than of the person ("Her research focuses on X" becomes
 * "Research focuses on X", "She studies X" becomes "Studies X").
 */
export function neutralResearchVoice(sentence: string): string {
  const possessive = PERSON_RESEARCH_SUBJECT.exec(sentence);
  if (possessive) {
    return capitalize(sentence.slice(possessive[0].length - possessive[1].length));
  }
  const pronoun = PERSON_PRONOUN_VERB.exec(sentence);
  if (pronoun) return capitalize(sentence.slice(pronoun[0].length - pronoun[1].length));
  return sentence;
}

function isPastResearchSentence(sentence: string): boolean {
  return PAST_RESEARCH_SENTENCE.test(sentence) || FIRST_PERSON_PAST_RESEARCH.test(sentence);
}

function isNonResearchOnlySentence(sentence: string): boolean {
  return NON_RESEARCH_ONLY_SENTENCE.test(sentence) && !RESEARCH_WORD.test(sentence);
}

/**
 * Derives a research statement from a person's profile biography: the sentences
 * that state, in the present, research the person does, restated in a neutral
 * voice. Career facts, CV records, past research, and teaching- or
 * clinical-service-only sentences are dropped. Returns a rejection when nothing
 * that states current research survives, because a biography with no such
 * sentence is not evidence of a research home.
 */
export function deriveBioResearchStatement(
  bio: unknown,
  person: { name?: string } = {},
): BioResearchStatement {
  const text = typeof bio === 'string' ? bio.replace(/\s+/g, ' ').trim() : '';
  if (!text)
    return { fullDescription: '', sentences: [], evidenceSentences: [], rejection: 'empty_bio' };
  const candidates = researchStatementSentences(text, { activityAnchors: true });
  if (candidates.length === 0) {
    return {
      fullDescription: '',
      sentences: [],
      evidenceSentences: [],
      rejection: 'no_research_statement',
    };
  }
  const current = candidates.filter(
    (sentence) =>
      RESEARCH_WORD.test(sentence) &&
      !NOT_RESEARCH_CONTENT_SENTENCE.test(sentence) &&
      !isCareerFactSentence(sentence) &&
      !isPastResearchSentence(sentence) &&
      !isNonResearchOnlySentence(sentence) &&
      !CLINICAL_SERVICE_FOCUS.test(sentence) &&
      !(CLINICAL_SPECIALTY_SENTENCE.test(sentence) && !SCHOLARLY_INQUIRY.test(sentence)) &&
      !isClinicalOnlyBiographySentence(sentence) &&
      !DANGLING_REFERENCE_OPENER.test(sentence.trim()) &&
      !CITATION_FRAGMENT.test(sentence),
  );
  if (current.length === 0) {
    return {
      fullDescription: '',
      sentences: [],
      evidenceSentences: [],
      rejection: 'only_past_research',
    };
  }
  const entity = { entityType: 'FACULTY_RESEARCH_AREA', name: person.name || '' };
  const sentences = current.map((sentence) =>
    neutralResearchVoice(revoiceFirstPersonResearchLead(sentence, entity as any)),
  );
  const fullDescription = sentences.join(' ');
  if (!fullDescriptionQuality(fullDescription).isUseful) {
    return {
      fullDescription,
      sentences,
      evidenceSentences: current,
      rejection: 'not_useful_after_filtering',
    };
  }
  return { fullDescription, sentences, evidenceSentences: current };
}
