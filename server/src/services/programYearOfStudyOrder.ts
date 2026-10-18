export const YEAR_OF_STUDY_PROGRESSION: readonly string[] = [
  'First-Year Student',
  'Sophomore',
  'Junior',
  'Senior',
  'Master’s Student',
  'Grad/Prof Year1',
  'Grad/Prof Year2',
  'Grad/Prof Year3',
  'Grad/Prof Year4',
  'Graduate Pre-Candidacy',
  'PhD Pre-Candidacy',
  'PhD Post-Candidacy',
  'JD',
  'MD',
  'Alumni',
];

const progressionRank = new Map(YEAR_OF_STUDY_PROGRESSION.map((value, rank) => [value, rank]));

export const orderYearOfStudyOptions = (values: readonly string[]): string[] =>
  [...values].sort((a, b) => {
    const rankA = progressionRank.get(a) ?? YEAR_OF_STUDY_PROGRESSION.length;
    const rankB = progressionRank.get(b) ?? YEAR_OF_STUDY_PROGRESSION.length;
    return rankA - rankB || a.localeCompare(b);
  });
