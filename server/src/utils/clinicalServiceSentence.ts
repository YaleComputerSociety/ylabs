import {
  CLINICAL_SERVICE_FOCUS,
  CLINICAL_SPECIALTY_SENTENCE,
  RESEARCH_WORD,
  SCHOLARLY_INQUIRY,
} from './bioResearchStatement';

const CLINICAL_CONTEXT =
  /\b(?:patients?|clinical(?:ly)?|clinicians?|physicians?|surgeons?|surg(?:ery|eries|ical)|(?:internal|family|pulmonary|emergency|sports|pediatric|nuclear|integrative|palliative|addiction|critical care|transplant) medicine|pediatric\w*|paediatric\w*|anesthe\w*|nurs(?:e|es|ing)|therap(?:y|ies|ist|ists)|treatment|diagnos\w*|disorders?|diseases?|care|(?:cardi|onc|neur|dermat|gastroenter|ur|radi|pulmon|nephr|hemat|haemat|endocrin|rheumat|ophthalm|otolaryng|immun|allerg|gynec|neonat|hepat)olog(?:y|ist|ists|ic|ical))\b|\b(?:psychiatr\w*|orthop(?:a)?edic\w*|obstetric\w*|interventional|board[- ]certified|residency|fellowship-trained)\b/i;
const CLINICAL_ONLY =
  /\b(?:sees\s+patients|clinical\s+(?:practice|care|service)|board[- ]certified|practices\s+(?:general|internal|family)|patient\s+care)\b/i;
const NOT_CLINICAL_ONLY_SUBJECT = /\b(?:effects?|AI|tools?|integration)\b/;
const PRACTICE_SETTING =
  /\b(?:private practice|(?:her|his|their) clinical practice|(?:sees|treats|cares for|caring for) patients|has practiced as|board[- ]certified|attending (?:physician|psychiatrist|surgeon|pathologist)|nurse practitioner|(?:her|his|their) clinical (?:interests?|work|care|expertise) (?:are|is|include|includes|focus|focuses|lies))\b/i;
const CLINICAL_INTERESTS_LIST =
  /\b(?:clinical|clinical and (?:academic|research)) (?:interests?|expertise|specialt(?:y|ies)|focus)\b/i;
const RESEARCH_VOICED_CLINICAL =
  /^(?:Studies|Focuses\s+on|Investigates|Examines)\s+(?:the\s+)?(?:clinical\s+(?:care|diagnosis|management|practice|evaluation)|(?:medical|surgical|clinical|laser|operative)(?:\s+and\s+(?:medical|surgical|clinical|laser|operative))?\s+(?:treatment|management|care)|diagnosis\s+and\s+(?:treatment|management)|(?:assessment|evaluation)\s+and\s+treatment|care\s+(?:of|for)\s+(?:patients|children|adults))\b/i;
const PROVIDES_CLINICAL_CARE =
  /^(?:Provides|Delivers|Offers)\s+(?:\w+\s+){0,3}(?:clinical\s+care|care|treatment|anesthesia|surgery)\b/i;
const INQUIRY_BESIDE_CLINICAL =
  /\b(?:research\w*|trials?|outcomes|mechanisms?|data|cohorts?|meta-analys\w*|systematic review|evaluat\w*|models?|novel|biomarkers?|registr(?:y|ies)|epidemiolog\w*|implementation science|quality improvement|investigat\w*|genetic\w*|imaging (?:methods|techniques))\b/i;
const PATIENT_FACING =
  /\byour (?:child|family|care|visit|surgery|loved one)\b|\b(?:helping|help) (?:each |every )?patients?\b/i;
const CLINICIAN_CAREER =
  /\b(?:trained|training|completed|graduated|received\s+(?:his|her|their)|has\s+joined|joined\s+the|residency|fellowship-trained|(?:nationally|internationally)\s+recognized|has\s+been\s+in\s+the\s+[\w\s-]{0,40}\s+field|for\s+over\s+\d+\s+years)\b/i;

/**
 * A sentence about a clinician's service rather than research (#5537): a clinical specialty,
 * the care given, the conditions treated or the procedures performed, or a patient-facing line.
 * A sentence that also names inquiry (research, trials, outcomes, mechanisms) is not one.
 */
export function isClinicalServiceSentence(sentence: string): boolean {
  const text = sentence.trim();
  const namesInquiry = INQUIRY_BESIDE_CLINICAL.test(text);
  if (CLINICAL_SERVICE_FOCUS.test(text) && !/\bresearch\b/i.test(text)) return true;
  if (
    CLINICAL_SPECIALTY_SENTENCE.test(text) &&
    !SCHOLARLY_INQUIRY.test(text) &&
    CLINICAL_CONTEXT.test(text)
  ) {
    return true;
  }
  if (
    CLINICAL_ONLY.test(text) &&
    !RESEARCH_WORD.test(text) &&
    !namesInquiry &&
    !NOT_CLINICAL_ONLY_SUBJECT.test(text)
  ) {
    return true;
  }
  if ((PRACTICE_SETTING.test(text) || CLINICAL_INTERESTS_LIST.test(text)) && !namesInquiry) {
    return true;
  }
  if (PATIENT_FACING.test(text)) return true;
  return (
    (RESEARCH_VOICED_CLINICAL.test(text) || PROVIDES_CLINICAL_CARE.test(text)) && !namesInquiry
  );
}

export const isClinicianCareerSentence = (sentence: string): boolean =>
  CLINICIAN_CAREER.test(sentence);
