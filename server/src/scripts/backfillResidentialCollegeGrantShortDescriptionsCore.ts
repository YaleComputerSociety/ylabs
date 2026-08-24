/**
 * Detects the verbatim, non-distinguishing shortDescription shared across the
 * Yale residential-college Mellon Senior Research Grant family and derives a
 * distinguishing replacement naming each entity's own college (#1557). The
 * boilerplate pattern tolerates the off-set/offset and senior essay/essay
 * wording drift already observed live across colleges so every family member
 * is caught by one signature rather than an exact-string list.
 */
const RESIDENTIAL_COLLEGE_GRANT_BOILERPLATE_PATTERN =
  /^to provide funding to off-?set the costs associated with a senior research project or (?:senior )?essay\.?$/i;

export function isResidentialCollegeGrantBoilerplateShortDescription(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return RESIDENTIAL_COLLEGE_GRANT_BOILERPLATE_PATTERN.test(value.trim());
}

const COLLEGE_NAME_FROM_DISPLAY_NAME_PATTERN = /^(.*?)\s*(?:College\s+)?Mellon\b/i;

/**
 * Extracts the residential college name from a Mellon-family entity's own
 * displayName ("Grace Hopper Mellon Senior Research Grant" -> "Grace Hopper",
 * "Benjamin Franklin College Mellon Research Fellowship for Seniors" ->
 * "Benjamin Franklin"), so the distinguishing text is always grounded in the
 * entity's own name rather than a hand-maintained college list. Returns '' if
 * the name does not follow the family's naming shape.
 */
export function deriveResidentialCollegeName(displayName: unknown): string {
  if (typeof displayName !== 'string') return '';
  const match = displayName.trim().match(COLLEGE_NAME_FROM_DISPLAY_NAME_PATTERN);
  return match?.[1]?.trim() || '';
}

export function buildResidentialCollegeGrantShortDescription(collegeName: string): string {
  return `Funds a senior research project or senior essay for ${collegeName} College students.`;
}
