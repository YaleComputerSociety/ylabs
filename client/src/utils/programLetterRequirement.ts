export type ProgramLetterRequirement = 'faculty' | 'recommendation';

const LETTER =
  /\bletters?\s+(?:or\s+emails?\s+)?of\s+(?:recommendation|reference)\b|\b(?:recommendation|reference)\s+letters?\b|\bfaculty\s+(?:letters?|references?|recommendations?)\b|\bletters?\s+(?:of\s+support\s+)?(?:\(\s*)?(?:from|by)\s+(?:(?:a|an|the|your|one|two|three)\s+)?(?:yale\s+)?(?:faculty|professors?|advis[eo]rs?|instructors?|mentors?)\b/i;
const FACULTY = /\b(?:faculty|professors?|advis[eo]rs?|instructors?|mentors?)\b/i;
const NOT_ASKED =
  /\bnot\s+(?:required|necessary|needed)\b|\boptional\b|\bno\s+letters?\b|\bwill\s+not\s+be\s+accepted\b/i;

const sentences = (text: string): string[] =>
  text
    .split(/(?<=[.!?;])\s+|\n+|[•●]/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

/**
 * Whether a program's own application text asks for a faculty letter or a recommendation.
 * A letter is not a mentor (#4131, #4218), so this never changes the mentor answer's
 * verdict; it only lets the answer say that a letter is still needed (#5302).
 */
export const programLetterRequirement = (program: {
  applicationMaterials?: readonly string[] | null;
  applicationInformation?: string | null;
}): ProgramLetterRequirement | null => {
  const asked = [...(program.applicationMaterials ?? []), program.applicationInformation ?? '']
    .flatMap(sentences)
    .filter((sentence) => LETTER.test(sentence) && !NOT_ASKED.test(sentence));
  if (asked.length === 0) return null;
  return asked.some((sentence) => FACULTY.test(sentence)) ? 'faculty' : 'recommendation';
};

export const NO_MENTOR_FIRST_ANSWER = 'Not usually';

export const noMentorFirstAnswer = (letter: ProgramLetterRequirement | null): string => {
  if (letter === 'faculty') return 'No mentor needed first, but you will need a faculty letter';
  if (letter === 'recommendation') {
    return 'No mentor needed first, but you will need a recommendation letter';
  }
  return NO_MENTOR_FIRST_ANSWER;
};
