// Mirrors YEAR_OF_STUDY_PROGRESSION in server/src/services/programYearOfStudyOrder.ts; change both together.
const YEAR_OF_STUDY_PROGRESSION: readonly string[] = [
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

const UNDERGRADUATE_YEARS = YEAR_OF_STUDY_PROGRESSION.slice(0, 4);

export const ALL_UNDERGRADUATE_YEARS_LABEL = 'All undergraduate years';

const progressionRank = new Map(YEAR_OF_STUDY_PROGRESSION.map((value, rank) => [value, rank]));

const byProgression = (a: string, b: string): number =>
  (progressionRank.get(a) ?? YEAR_OF_STUDY_PROGRESSION.length) -
    (progressionRank.get(b) ?? YEAR_OF_STUDY_PROGRESSION.length) || a.localeCompare(b);

export const yearOfStudyChipLabels = (years: readonly string[]): string[] => {
  const ordered = [...new Set(years)].sort(byProgression);
  if (!UNDERGRADUATE_YEARS.every((year) => ordered.includes(year))) return ordered;
  return [
    ALL_UNDERGRADUATE_YEARS_LABEL,
    ...ordered.filter((year) => !UNDERGRADUATE_YEARS.includes(year)),
  ];
};
