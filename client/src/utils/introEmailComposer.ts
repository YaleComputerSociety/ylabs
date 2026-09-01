import { MAX_SAFE_MAILTO_BODY_LENGTH, MAX_SAFE_MAILTO_SUBJECT_LENGTH } from './url';

export const STUDENT_INTRO_EMAIL_TEMPLATE_VERSION = 'student-intro-v1';
export const FALLBACK_INTRO_EMAIL_SUBJECT = 'Interest in undergraduate research';

const PLACEHOLDER_TOKEN_PATTERN = /\[[^\]]*\]|\{\{?[^}]*\}?\}|<[^>]+>|\bredacted\b/i;

export interface StudentIntroEmailDraftInput {
  entityName?: string;
  leadName?: string;
  researchAreas?: string[];
  bestNextStep?: string;
}

export interface StudentIntroEmailDraft {
  subject: string;
  body: string;
  generatedByPlatform: boolean;
  templateVersion: string;
}

const fallbackDraft = (): StudentIntroEmailDraft => ({
  subject: FALLBACK_INTRO_EMAIL_SUBJECT,
  body: '',
  generatedByPlatform: false,
  templateVersion: '',
});

const cleanFragment = (value?: string): string => {
  const collapsed = value?.replace(/\s+/g, ' ').trim() || '';
  if (!collapsed || PLACEHOLDER_TOKEN_PATTERN.test(collapsed)) return '';
  return collapsed;
};

const researchAreasPhrase = (areas: string[]): string => {
  const [first, second] = areas;
  if (first && second) return ` in ${first} and ${second}`;
  if (first) return ` in ${first}`;
  return '';
};

const involvementAsk = (bestNextStep?: string): string => {
  const normalized = (bestNextStep || '').toLowerCase();
  if (/credit|thesis|senior project/.test(normalized)) {
    return 'I would love to learn more about your work and whether there might be a way for me to get involved, including how research credit or a senior project might fit.';
  }
  if (/funding|fellowship|grant|stipend/.test(normalized)) {
    return 'I would love to learn more about your work and whether there might be a way for me to get involved, including any funded or fellowship-supported roles.';
  }
  if (/availab|currently|taking on|confirm/.test(normalized)) {
    return 'I wanted to ask whether you are currently taking on undergraduate researchers, and if so, whether there might be a way for me to get involved.';
  }
  return 'I would love to learn more about your work and whether there might be a way for me to get involved.';
};

export const composeStudentIntroEmailDraft = (
  input: StudentIntroEmailDraftInput,
): StudentIntroEmailDraft => {
  const entityName = cleanFragment(input.entityName);
  if (!entityName) return fallbackDraft();

  const leadName = cleanFragment(input.leadName);
  const researchAreas = (input.researchAreas || [])
    .map((area) => cleanFragment(area))
    .filter(Boolean)
    .slice(0, 2);

  const subject = `Interest in undergraduate research with ${entityName}`;
  const greeting = leadName ? `Dear ${leadName},` : 'Hello,';
  const body = [
    greeting,
    '',
    `I am a Yale undergraduate interested in research opportunities${researchAreasPhrase(
      researchAreas,
    )} with ${entityName}. ${involvementAsk(input.bestNextStep)}`,
    '',
    'Thank you for your time, and I look forward to hearing from you.',
  ].join('\n');

  if (
    subject.length > MAX_SAFE_MAILTO_SUBJECT_LENGTH ||
    body.length > MAX_SAFE_MAILTO_BODY_LENGTH ||
    PLACEHOLDER_TOKEN_PATTERN.test(subject) ||
    PLACEHOLDER_TOKEN_PATTERN.test(body)
  ) {
    return fallbackDraft();
  }

  return {
    subject,
    body,
    generatedByPlatform: true,
    templateVersion: STUDENT_INTRO_EMAIL_TEMPLATE_VERSION,
  };
};
