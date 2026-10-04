const HONOR_NOUN = String.raw`(?:Prize|Award|Medal|Lectureship)s?`;

const honorNounPattern = new RegExp(String.raw`\b${HONOR_NOUN}\b`);
const studiesHonorTemplatePattern = new RegExp(
  String.raw`^Studies(?:\s+[A-Z][\w'’&-]*){1,6}\s+${HONOR_NOUN}\s*\.?$`,
);

const capitalizedNounUsePattern = /(?<!^)\b(?:Studies|Research)\b/g;

const researchActivityVerbPattern =
  /\b(?:stud(?:y|ies|ied|ying)|research(?:es|ed|ing)?|investigat\w*|examin\w*|explor\w*|focus\w*|develop\w*|analy[sz]\w*|works?|worked|working|aims?|seeks?|uses?|using|interest\w*|improv\w*|understand\w*|identif\w*|characteriz\w*|model(?:s|ed|ing|led|ling)|design\w*|builds?|building|treat\w*|address\w*|prob(?:e|es|ed|ing)|maps?|mapping|measur\w*|tests?|testing|evaluat\w*|tracks?|tracing|documents?|documenting|unearth\w*|advanc\w*|speciali[sz]\w*|appl(?:y|ies|ied|ying)|leads?|directs?|creat\w*|combin\w*|integrat\w*|conduct\w*|perform\w*|runs?|running|collaborat\w*|addresses|specifically)\b/i;

const titleNumberTitlePattern =
  /\b(?!(?:Type|Phase|Stage|Grade|Class|Level|Tier|Category|Group)\b)[A-Z][\w'’-]*\s+\d{1,4}\s+[A-Z][\w'’-]*/;

const siteTaglinePattern =
  /^(?:the\s+)?(?:official\s+(?:web\s*)?site|(?:personal\s+)?home\s*page|homepage|web\s*site|welcome\s+to)\b/i;

const presentationRemarkPattern =
  /^(?:(?:Dr|Prof)\.\s+)?[^.;:]{0,80}?\bha(?:s|ve)\s+(?:(?:presented|lectured|spoken)(?:\s+(?:his|her|their|its)\s+(?:work|research))?\s+(?:at|to|widely|internationally|nationally|extensively)\b|given\s+(?:invited\s+)?(?:talks|lectures|presentations|keynotes?)\b)/i;

const programRenameNotePattern = /\s*\(now\s+[A-Z][A-Z0-9&-]{2,}\)/g;

function namesResearchActivity(value: string): boolean {
  return researchActivityVerbPattern.test(value.replace(capitalizedNounUsePattern, ' '));
}

export function isNonResearchCardSentence(text: unknown): boolean {
  const value = String(text || '').trim();
  if (!value) return false;
  if (siteTaglinePattern.test(value)) return true;
  if (presentationRemarkPattern.test(value)) return true;
  if (studiesHonorTemplatePattern.test(value)) return true;
  if (namesResearchActivity(value)) return false;
  if (honorNounPattern.test(value)) return true;
  return titleNumberTitlePattern.test(value);
}

export function stripProgramRenameNote(text: string): string {
  return text.replace(programRenameNotePattern, '');
}
