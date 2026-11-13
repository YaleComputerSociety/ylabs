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
  /\bworks?\s+with\s+patients\s+to\s+(?!(?:better\s+)?(?:understand|learn)\b)/i,
  /\beach\s+patient(?:['’]s)?\b/i,
  /\bhelp(?:s|ing)?\s+(?:each\s+)?(?:patients?|famil(?:y|ies))\b/i,
  /\bpartnering\s+with\s+patients\b/i,
  /\bgetting\s+patients\s+back\b/i,
];

const NOT_AFTER_ANOTHER_CARE_GIVER =
  '(?<!\\b(?:clinicians|physicians|providers|caregivers|doctors|nurses|surgeons|practitioners|teams|clinics|hospitals)\\s+(?:(?:who|that)\\s+)?(?:(?:are|were|is|was|have|has|had|can|will)\\s+)?(?:to\\s+)?(?:(?:\\w+ly|better|more|also|still|best)\\s+){0,2})';

// The service verbs #6151 added are accepted only after the bio's own person: a sentence
// start, a pronoun, or a preposition or catenative verb directly before the verb. A noun
// there (pharmacists, residents, a clinic that) is someone else's patients.
const AFTER_THE_BIOS_OWN_PERSON =
  '(?<=(?:^|[.;:!?]\\s+|\\b(?:he|she|they|i|we|to|for|in|on|at|by|with|while|after|before|enjoys?|loves?|likes?|committed|dedicated|devoted)\\s+)(?:(?:has|have|had|having|is|are|was|were|been|also|still|and|\\w+ly)\\s+){0,3})';

const PATIENT_SERVICE_PURPOSE = new RegExp(
  `${NOT_AFTER_ANOTHER_CARE_GIVER}\\b(?:help|helps|helping|serve|serves|serving|benefit|benefits)\\s+(?:his|her|their)\\s+(?:own\\s+)?patients\\b`,
  'i',
);

const PATIENT_SERVICE_SHAPES = [
  new RegExp(
    `${NOT_AFTER_ANOTHER_CARE_GIVER}\\b(?:treat(?:s|ing)?|cares?\\s+for|caring\\s+for|sees|seeing|provid(?:e|es|ed|ing)\\s+care\\s+(?:to|for)|help(?:s|ing)?|serv(?:e|es|ing))\\s+(?:all\\s+)?(?:his|her|their)\\s+(?:own\\s+)?patients\\b`,
    'i',
  ),
  new RegExp(
    `${NOT_AFTER_ANOTHER_CARE_GIVER}${AFTER_THE_BIOS_OWN_PERSON}(?:manag(?:es|ing)|(?:has|have|had|having)\\s+(?:\\w+ly\\s+)?(?:treated|managed))\\s+patients\\b`,
    'i',
  ),
  new RegExp(
    `${NOT_AFTER_ANOTHER_CARE_GIVER}${AFTER_THE_BIOS_OWN_PERSON}(?:manag(?:e|es|ing|ed)|support(?:s|ing|ed)?|giv(?:e|es|ing|en)|treated)\\s+(?:all\\s+)?(?:his|her|their)\\s+(?:own\\s+)?patients\\b`,
    'i',
  ),
  new RegExp(
    `${NOT_AFTER_ANOTHER_CARE_GIVER}${AFTER_THE_BIOS_OWN_PERSON}(?:working|worked)\\s+with\\s+patients\\s+to\\s+(?!(?:better\\s+)?(?:understand|learn)\\b|(?:build|develop|design|create|co-create|co-design|co-produce|test|pilot|evaluate|study|record|measure|identify|map|document|adapt|reshape)\\b)`,
    'i',
  ),
  /\b(?:combat\w*|treat(?:s|ing)?|alleviat\w*|reliev\w*)\s+(?:the\s+)?symptoms\b/i,
];

const CLINICAL_VOCABULARY =
  /\b(?:patients?|care|clinical(?:ly)?|clinicians?|medical|medicine|disorders?|diseases?|conditions?|syndromes?|symptoms?|treatment|therap(?:y|ies)|diagnos\w*|surg(?:ery|eries|ical)|nutrition|pain|injur(?:y|ies)|infections?|cancers?|tumou?rs?|neurological|psychiatric|mental\s+health|pregnanc(?:y|ies)|asthma|allerg(?:y|ies)|dermatolog\w*|cardiolog\w*|skin|nerves?|spin(?:e|al)|stimulation|anesthe\w*|procedures?|trauma)\b/i;

const STATES_INQUIRY =
  /\b(?:research\w*|lab(?:s|oratory|oratories)?|stud(?:y|ies|ying|ied)|investigat\w*|trials?|scien\w*|scholar\w*|examin\w*|explor\w*|analy[sz]\w*|evaluat\w*|measur\w*|experiment\w*|discover\w*|mechanisms?|data|cohorts?|outcomes|epidemiolog\w*|biomarkers?|interventions?|understand(?:ing)?\s+(?:the|how|why|what|whether)|how|technolog\w*|informatics|quality\s+of\s+care|health\s+services|disparit(?:y|ies)|\w*ethic(?:s|al)|model(?:ing|ling)|(?:computational|statistical|mathematical|animal|mouse|murine|predictive)\s+models?|biolog\w*|genes?|genetic\w*|genomic\w*|why|whether|engineer\w*|benchmark\w*|machine\s+learning|build(?:s|ing)?\s+(?:new\s+|novel\s+)?(?:[\w-]+\s+){0,2}(?:tools?|devices?|sensors?|software|robots?|systems?|platforms?)|software|robot\w*|sensors?|wearables?|survey\w*|assess\w*|pilot(?:s|ing|ed)?|prob(?:e|es|ing)|imaging|estimat\w*|registr(?:y|ies)|track(?:s|ing)|characteri[sz]\w*|quantif\w*|randomi[sz]\w*|predict\w*|catalog\w*|correlat\w*|compar(?:e|es|ing|ison|isons)|algorithms?|sequenc(?:e|es|ing)|(?:co-)?design(?:s|ing|ed)?|map(?:s|ping)?\s+(?:the|how|which|where)|improv(?:e|es|ing)\s+(?:the\s+)?(?:[\w-]+\s+){0,2}care|immunolog\w*|pharmacolog\w*|pathogenesis|microbiome|circuits?|prevention|screening|polic(?:y|ies)|decision[-\s]making|safety|implementation|develop\w*\s+(?:and\s+test\s+)?(?:new\s+|novel\s+)?(?:[\w-]+\s+){0,2}(?:tools?|devices?|sensors?|therap\w*|methods?|strateg(?:y|ies)|approach(?:es)?|models?|algorithms?|interventions?|measures?|assays?|drugs?|vaccines?|gene)|test(?:s|ing)?\b)\b/i;

const CREATIVE_PRACTICE =
  /\b(?:music\w*|compos(?:e|es|er|ers|ing|ition|itions)|choreograph\w*|danc(?:e|es|er|ers|ing)|(?<!to-)plays?|playwright\w*|theat(?:er|re)\w*|performance\s+art|performers?|artists?|artwork|paint\w*|sculpt\w*|poe(?:t|ts|try|ms?)|fiction|novels?|writ(?:e|es|ing)\s+(?:plays|poems|fiction|novels|music)|film\w*|photograph\w*|portrait\w*|documentar\w*|opera|songs?|lullab\w*|murals?|memoirs?|essays?|textiles?|installations?|comed(?:y|ies|ian|ians)|stand-up)\b/i;

const CONDITION_HEAD_WORDS = new Set(
  [
    'acne rosacea eczema psoriasis scarring scars scar vitiligo melasma warts alopecia hyperhidrosis',
    'hernia hernias contracture contractures fracture fractures arthritis osteoarthritis scoliosis',
    'stenosis sciatica migraine migraines headache headaches epilepsy seizures diabetes obesity',
    'hypertension asthma allergies allergy copd dementia glaucoma cataract cataracts incontinence',
    'infertility endometriosis fibroids sepsis pneumonia anemia lupus gout ulcers ulcer reflux',
    'constipation cirrhosis insomnia apnea cancer cancers tumor tumors tumour tumours lesion lesions',
    'deformity deformities disease diseases disorder disorders syndrome syndromes injury injuries',
    'infection infections malformation malformations aneurysm aneurysms carcinoma melanoma lymphoma',
    'leukemia sarcoma metastases polyps cysts nodules stones keloids moles burns wounds wound',
    'neuropathy retinopathy cardiomyopathy dysplasia instability tears tear sprains concussion',
    'concussions spasticity tremor tremors dysphagia dysphonia vertigo tinnitus palsy paralysis',
    'amputation amputations dermatology cardiology oncology neurology gastroenterology rheumatology',
    'urology nephrology hematology endocrinology ophthalmology otolaryngology gynecology obstetrics',
    'orthopedics orthopaedics pediatrics geriatrics surgery surgeries arthroplasty arthroscopy',
    'endoscopy colonoscopy laparoscopy rhinoplasty ablation resection transplantation transplant',
    'transplants implants implant injections fillers botox liposuction lift lifts cholera syphilis',
    'tuberculosis malaria',
  ]
    .join(' ')
    .split(' '),
);

const CONDITION_HEAD_SUFFIX =
  /(?:itis|osis|ectomy|ostomy|plasty|oma|omas|emia|plegia|algia|pathy|pathies)$/;

const WORDS_WITH_A_CONDITION_SUFFIX_THAT_ARE_NOT_CONDITIONS = new Set(
  [
    'diagnosis prognosis apoptosis symbiosis osmosis hypnosis metamorphosis neurosis hypothesis',
    'synthesis thesis genesis diploma diplomas aroma stigma oklahoma empathy sympathy apathy',
    'telepathy antipathy homeopathy nostalgia dichotomy anatomy',
  ]
    .join(' ')
    .split(' '),
);

const HEADS_THAT_NAME_A_CONDITION_ONLY_WITH_A_MODIFIER = new Set(
  'pain depression anxiety addiction trauma stroke strokes reconstruction repair release replacement loss'.split(
    ' ',
  ),
);

const CARE_ACTIVITY_HEADS = new Set(
  'management treatment treatments care diagnosis evaluation therapy therapies repair prevention'.split(
    ' ',
  ),
);

const PATIENT_GROUP_HEAD =
  /^(?:patients|children|adults|adolescents|athletes|women|men|individuals|people|infants)$/;

const ANATOMY_WORDS =
  '(?:hand|hands|wrist|wrists|finger|fingers|elbow|elbows|shoulder|shoulders|knee|knees|hip|hips|ankle|ankles|foot|feet|spine|spinal|back|neck|nerve|nerves|skin|hair|nail|nails|face|facial|breast|abdominal|wall|plexus|tendon|tendons|ligament|ligaments|joint|joints|bone|bones|cartilage|eye|eyes|ear|ears|nose|nasal|sinus|sinuses|throat|voice|vocal|heart|cardiac|lung|lungs|liver|kidney|kidneys|bladder|bowel|colon|pelvic|pelvis|uterine|prostate|thyroid|brain|memory|hearing|vision|weight|extremity|extremities|limb|limbs)';

const ANATOMY_WORD = new RegExp(`\\b${ANATOMY_WORDS}\\b`, 'i');

const BODY_SITE_TAIL = new RegExp(
  `^\\s+of\\s+(?:the\\s+)?(?:(?:upper|lower|left|right|inner|outer|middle|small|large)\\s+)?${ANATOMY_WORDS}(?:\\s+and\\s+(?:the\\s+)?${ANATOMY_WORDS})*$`,
  'i',
);

const BARE_BODY_SITE = new RegExp(`^(?:the\\s+)?${ANATOMY_WORDS}$`, 'i');

const PATIENT_GROUP_TAIL =
  /^\s+in\s+(?:(?:older|elderly|young|younger|adult|pediatric|paediatric|school-age|teenage|elite|competitive|female|male|high-school|college)\s+){0,2}(?:patients|children|adults|adolescents|teens|teenagers|athletes|women|men|infants|newborns|neonates|veterans|runners)$/i;

const NAMED_CONDITION_PHRASE =
  /\b(?:trigger\s+finger|tennis\s+elbow|golfer['’]?s\s+elbow|frozen\s+shoulder|carpal\s+tunnel|club\s*foot|cleft\s+(?:lip|palate)|hair\s+loss|memory\s+loss|hearing\s+loss|vision\s+loss|sleep\s+apnea)$/i;

const SPECIAL_INTERESTS_LIST_FRAME =
  /\b(?:(?:special|particular|clinical|subspecialty|surgical)\s+(?:areas?\s+of\s+)?interests?|areas?\s+of\s+(?:special|particular|clinical)\s+interest)\s+(?:include|includes|are|is)\s*:?\s+(?!(?:in|on|to|that|with|for|about)\b)(.+?)[.!?]?\s*$/i;

const INTERESTS_IN_TREATING_FRAME =
  /\binterests?\s+include\s+(?:treating|managing|caring\s+for)\s+(.+?)[.!?]?\s*$/i;

const SPECIAL_INTEREST_IN_MANAGEMENT_OF_FRAME =
  /\b(?:special|particular)\s+interests?\s+(?:is\s+|are\s+)?in\s+the\s+(?:(?:surgical|medical|clinical|operative|non-?operative|comprehensive|multidisciplinary)\s+)?(?:management|treatment|care|repair)\s+of\s+(.+?)[.!?]?\s*$/i;

const PARTNERS_WITH_PATIENTS_TO_TREAT =
  /\bpartner(?:s|ing)?\s+with\s+(?:patients|families|caregivers|parents)\s+to\s+(?:manage|treat|control|cope\s+with|live\s+with)\b/i;

const CARES_FOR_PEOPLE_WITH =
  /\b(?:caring|cares)\s+for\s+(?:[\w-]+\s+){0,3}(?:with|after|who\s+have)\s+(.+?)[.!?]?\s*$/i;

const LEAD_THAT_MAKES_THE_BIOS_OWN_PERSON_THE_SUBJECT =
  /(?:^|[.;:!?]\s+|\b(?:he|she|they|i|we|focus(?:es|ed)?\s+on|interests?\s+(?:include|includes|are|is)|enjoys?|loves?|dedicated\s+to|committed\s+to|devoted\s+to|passionate\s+about|involves|includes)\s+)(?:(?:also|still|especially|particularly|primarily|\w+ly)\s+)?$/i;

const ITEM_HEAD_BOUNDARY =
  /\s(?:of|in|with|for|among|after|during|through|across|at|on|from|to|within|including|such|related|involving|following|and\s+its|via|using|by)\b/i;

const LEADING_DETERMINER = /^(?:the|a|an|all|various|complex|common|other|both|including)\s+/i;

const LIST_ITEM_SEPARATOR =
  /\s*[;,]\s*(?:and\s+|or\s+)?|\s+and\s+|\s+or\s+|\s+as\s+well\s+as\s+|\s+plus\s+/i;

const LIST_FILLER_ITEM = /^(?:but\s+are\s+not\s+limited\s+to|among\s+others|etc)$/i;

const LIST_LEAD_IN =
  /^(?:,\s*)?(?:but\s+(?:are\s+)?not\s+limited\s+to|among\s+other\s+things),?\s*/i;

const A_HISTORY_OF = /^a\s+history\s+of\s+/i;

const PATIENT_GROUP_WITH_OBJECT = /^\s+(?:with|who\s+have|after)\s+(.+)$/i;

const CARE_ACTIVITY_OF_OBJECT = /^\s+of\s+(.+)$/i;

const MAX_NESTED_ITEM_DEPTH = 2;

interface ListItemHead {
  headPhrase: string;
  head: string;
  writtenHead: string;
  modifiers: string[];
  startsWithThe: boolean;
  afterHead: string;
}

function listItemHead(item: string): ListItemHead {
  const trimmed = item.trim().replace(/^(?:and|or)\s+/i, '');
  const headPhrase = trimmed.split(ITEM_HEAD_BOUNDARY)[0];
  const words = headPhrase
    .replace(/[“”"()]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const writtenHead = (words[words.length - 1] || '')
    .replace(/[’']s$/, '')
    .replace(/[^\p{L}-]/gu, '');
  return {
    headPhrase: headPhrase.trim(),
    head: writtenHead.toLowerCase().split('-').pop() || '',
    writtenHead,
    modifiers: words.slice(0, -1).filter((word) => !LEADING_DETERMINER.test(`${word} `)),
    startsWithThe: /^the\s/i.test(trimmed),
    afterHead: trimmed.slice(headPhrase.length),
  };
}

function isConditionWord(word: string): boolean {
  if (WORDS_WITH_A_CONDITION_SUFFIX_THAT_ARE_NOT_CONDITIONS.has(word)) return false;
  return CONDITION_HEAD_WORDS.has(word) || (word.length > 5 && CONDITION_HEAD_SUFFIX.test(word));
}

function isAcronym(word: string): boolean {
  return word === word.toUpperCase().replace(/[^A-Z]/g, '');
}

function listItems(list: string): string[] {
  return list
    .split(LIST_ITEM_SEPARATOR)
    .map((item) => item.trim())
    .filter((item) => item && !LIST_FILLER_ITEM.test(item));
}

function placesTheItemInClinicalCare(afterHead: string): boolean {
  return !afterHead.trim() || BODY_SITE_TAIL.test(afterHead) || PATIENT_GROUP_TAIL.test(afterHead);
}

function rejoinBodySiteContinuations(items: string[]): string[] {
  return items.reduce<string[]>((joined, item) => {
    const previous = joined[joined.length - 1];
    if (
      previous &&
      BARE_BODY_SITE.test(item) &&
      BODY_SITE_TAIL.test(listItemHead(previous).afterHead)
    ) {
      joined[joined.length - 1] = `${previous} and ${item}`;
    } else {
      joined.push(item);
    }
    return joined;
  }, []);
}

function everyItemIsACondition(list: string, depth: number): boolean {
  const items = rejoinBodySiteContinuations(listItems(list));
  return items.length > 0 && items.every((item) => isConditionOrProcedureItem(item, depth));
}

function headNamesAConditionOrProcedure({
  headPhrase,
  head,
  writtenHead,
  modifiers,
  startsWithThe,
}: ListItemHead): boolean {
  if (NAMED_CONDITION_PHRASE.test(headPhrase)) return true;
  if (!head) return false;
  if (HEADS_THAT_NAME_A_CONDITION_ONLY_WITH_A_MODIFIER.has(head)) {
    return !startsWithThe && modifiers.length > 0 && writtenHead === writtenHead.toLowerCase();
  }
  if (CARE_ACTIVITY_HEADS.has(head)) {
    return modifiers.some(
      (modifier) =>
        isConditionWord(modifier.toLowerCase().replace(/[^\p{L}]/gu, '')) ||
        ANATOMY_WORD.test(modifier),
    );
  }
  return isConditionWord(head) && !isAcronym(writtenHead);
}

function isConditionOrProcedureItem(item: string, depth = 0): boolean {
  const trimmed = item.trim();
  if (A_HISTORY_OF.test(trimmed)) {
    return isConditionOrProcedureItem(trimmed.replace(A_HISTORY_OF, ''), depth + 1);
  }
  const itemHead = listItemHead(trimmed);
  if (PATIENT_GROUP_HEAD.test(itemHead.head)) {
    const withObject = PATIENT_GROUP_WITH_OBJECT.exec(itemHead.afterHead);
    return Boolean(
      withObject &&
      depth < MAX_NESTED_ITEM_DEPTH &&
      everyItemIsACondition(withObject[1], depth + 1),
    );
  }
  if (CARE_ACTIVITY_HEADS.has(itemHead.head)) {
    const ofObject = CARE_ACTIVITY_OF_OBJECT.exec(itemHead.afterHead);
    if (ofObject && depth < MAX_NESTED_ITEM_DEPTH)
      return everyItemIsACondition(ofObject[1], depth + 1);
  }
  return (
    placesTheItemInClinicalCare(itemHead.afterHead) && headNamesAConditionOrProcedure(itemHead)
  );
}

function isListOfConditionsOrProcedures(list: string): boolean {
  return everyItemIsACondition(list.replace(LIST_LEAD_IN, ''), 0);
}

function framedListIsAllConditions(frame: RegExp, sentence: string): boolean {
  const match = frame.exec(sentence);
  return Boolean(match && isListOfConditionsOrProcedures(match[1]));
}

function isSaidOfTheBiosOwnPerson(sentence: string, verbIndex: number): boolean {
  return LEAD_THAT_MAKES_THE_BIOS_OWN_PERSON_THE_SUBJECT.test(sentence.slice(0, verbIndex));
}

function isOwnPersonPartneringToTreat(sentence: string): boolean {
  const match = PARTNERS_WITH_PATIENTS_TO_TREAT.exec(sentence);
  return Boolean(match && isSaidOfTheBiosOwnPerson(sentence, match.index));
}

function isOwnPersonCaringForPeopleWithConditions(sentence: string): boolean {
  const match = CARES_FOR_PEOPLE_WITH.exec(sentence);
  return Boolean(
    match &&
    isSaidOfTheBiosOwnPerson(sentence, match.index) &&
    isListOfConditionsOrProcedures(match[1]),
  );
}

function isClinicalConditionListSentence(sentence: string): boolean {
  if (STATES_INQUIRY.test(sentence)) return false;
  return (
    framedListIsAllConditions(SPECIAL_INTERESTS_LIST_FRAME, sentence) ||
    framedListIsAllConditions(INTERESTS_IN_TREATING_FRAME, sentence) ||
    framedListIsAllConditions(SPECIAL_INTEREST_IN_MANAGEMENT_OF_FRAME, sentence) ||
    isOwnPersonPartneringToTreat(sentence) ||
    isOwnPersonCaringForPeopleWithConditions(sentence)
  );
}

export function isClinicalOnlyBiographySentence(sentence: string): boolean {
  if (CREATIVE_PRACTICE.test(sentence)) return false;
  if (isClinicalConditionListSentence(sentence)) return true;
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
