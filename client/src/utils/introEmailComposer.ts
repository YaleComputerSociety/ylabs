import { MAX_SAFE_MAILTO_BODY_LENGTH, MAX_SAFE_MAILTO_SUBJECT_LENGTH } from './url';

export const STUDENT_INTRO_EMAIL_TEMPLATE_VERSION = 'student-intro-v1';
export const FALLBACK_INTRO_EMAIL_SUBJECT = 'Interest in undergraduate research';

export interface StudentIntroEmailDraftInput {
  entityName?: string;
  leadName?: string;
  researchAreas?: string[];
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

const researchAreasPhrase = (areas: string[]): string => {
  const [first, second] = areas;
  if (first && second) return ` in ${first} and ${second}`;
  if (first) return ` in ${first}`;
  return '';
};

export const composeStudentIntroEmailDraft = (
  input: StudentIntroEmailDraftInput,
): StudentIntroEmailDraft => {
  const entityName = input.entityName?.trim();
  if (!entityName) return fallbackDraft();

  const leadName = input.leadName?.trim();
  const researchAreas = (input.researchAreas || [])
    .map((area) => area.trim())
    .filter(Boolean)
    .slice(0, 2);

  const subject = `Interest in undergraduate research with ${entityName}`;
  const greeting = leadName ? `Dear ${leadName},` : 'Hello,';
  const body = [
    greeting,
    '',
    `My name is [Your Name], and I am a Yale undergraduate interested in research opportunities${researchAreasPhrase(
      researchAreas,
    )} with ${entityName}. I would love to learn more about your work and whether there might be a way for me to get involved.`,
    '',
    'Thank you for your time, and I look forward to hearing from you.',
    '',
    '[Your Name]',
  ].join('\n');

  if (subject.length > MAX_SAFE_MAILTO_SUBJECT_LENGTH || body.length > MAX_SAFE_MAILTO_BODY_LENGTH) {
    return fallbackDraft();
  }

  return {
    subject,
    body,
    generatedByPlatform: true,
    templateVersion: STUDENT_INTRO_EMAIL_TEMPLATE_VERSION,
  };
};
