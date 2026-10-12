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

const PAST_RESEARCH_SENTENCE =
  /\b(?:was|were|had\s+been|previously|formerly|directed|led|founded|established|for\s+(?:over|more\s+than|nearly|almost)\s+(?:\d+|[a-z]+(?:-[a-z]+)?)\s+years|earlier\s+in\s+(?:his|her|their)\s+career|doctoral|dissertation|thesis|post-?doctoral|as\s+an?\s+(?:graduate|doctoral|ph\.?\s?d\.?|undergraduate|medical)\s+student|during\s+(?:his|her|their)\s+(?:ph\.?\s?d|doctoral|graduate|postdoctoral|residency|fellowship))\b/i;

const CLINICAL_SERVICE_FOCUS =
  /\b(?:focus(?:es|ed)?\s+on\s+(?:the\s+)?(?:surgical|medical|clinical|operative|non-?operative|comprehensive)?\s*(?:treatment|care|management|evaluation)\s+of\s+(?:patients|adults|children|women|men|people)|speciali[sz](?:es|ing)\s+in\s+(?:the\s+)?(?:surgical\s+|medical\s+|clinical\s+|minimally\s+invasive\s+)?(?:treatment|care|management|diagnosis|evaluation)\s+of)\b/i;

const CLINICAL_SPECIALTY_SENTENCE =
  /\bspeciali[sz](?:es|ing|ed)?\s+in\b|\b(?:primary\s+)?focus\s+is\s+(?:on\s+)?clinical\s+care\b|\bperforming\b[^.]{0,80}\bsurger(?:y|ies)\b/i;

const SCHOLARLY_INQUIRY =
  /\b(?:research|stud(?:y|ies|ying)|investigat\w*|scholar\w*|analy[sz]\w*|theor\w*)\b/i;

const NON_RESEARCH_ONLY_SENTENCE =
  /\b(?:teach(?:es|ing)?|courses?|curricul|sees\s+patients|clinical\s+(?:practice|care|service)|board[- ]certified|practices\s+(?:general|internal|family)|patient\s+care)\b/i;

const NOT_RESEARCH_CONTENT_SENTENCE =
  /\b(?:boards?\s+of|serves?\s+on|served|editor|editorial|reviewer|committee|council|task\s+force|president|co-?founder|founded|managing\s+partner|venture|funded\s+by|has\s+been\s+funded|grants?\s+from|book|forthcoming|to\s+appear|published\s+by|translations?|selected\s+publications|publications?\s*:|co-?edited|google\s+scholar|can\s+be\s+found|click|blogs?|website|administrative\s+roles?|appointment\s+as|private\s+practice|co-?authors?\s+of|co-?authored|has\s+appeared\s+in|appeared\s+in|appears\s+in|edited\s+by|in\s+press|new\s+york\s+times|washington\s+post|wall\s+street\s+journal|the\s+atlantic|npr\b|cares?\s+for\s+patients|(?:his|her|their)\s+practice|clinical\s+expertise|board[- ]certified|holds\s+an?\s+(?:MSc|MA|MS|BA|BS|PhD|MD)|studied\s+medicine|completed|graduated|has\s+joined|joined\s+the|enthusiasm\s+for|received\s+(?:his|her|their)|trained)\b/i;

const CITATION_FRAGMENT =
  /\beds?\.(?=[\s,)])|\((?:eds?|ed)\.?\)|\b\d+\s*\(\d+\)\s*[:,]|\bpp\.\s*\d|\bvol\.\s*\d|[“"][^”"]{8,}[”"]\s*,?\s*in\s+[A-Z]/;

const DANGLING_REFERENCE_OPENER =
  /^(?:The\s+latter|The\s+former|These|This\s+(?:work|book|project|volume))\b/;

const RESEARCH_WORD =
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
  return PAST_RESEARCH_SENTENCE.test(sentence);
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
