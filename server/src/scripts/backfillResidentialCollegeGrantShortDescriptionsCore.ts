/**
 * Detects a non-distinguishing shortDescription shared verbatim across a Yale
 * residential-college fellowship/grant family and derives a distinguishing
 * replacement naming each entity's own college (#1557). Two families are
 * covered so far: the Mellon Senior Research Grant (boilerplate-signature
 * detection, since every member already carries the shared text) and the
 * Richter Summer Fellowship (displayName-shape detection, since one member -
 * Berkeley - carries a different, malformed section-header-fragment short
 * rather than the shared text, and still needs the same distinguishing
 * replacement).
 */
const MELLON_GRANT_BOILERPLATE_PATTERN =
  /^to provide funding to off-?set the costs associated with a senior research project or (?:senior )?essay\.?$/i;

export function isResidentialCollegeGrantBoilerplateShortDescription(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return MELLON_GRANT_BOILERPLATE_PATTERN.test(value.trim());
}

/**
 * Extracts the residential college name that immediately precedes the given
 * anchor word in a family member's own displayName ("Grace Hopper Mellon
 * Senior Research Grant" + anchor "Mellon" -> "Grace Hopper", "Benjamin
 * Franklin College Richter Fellowship" + anchor "Richter" -> "Benjamin
 * Franklin"), so the distinguishing text is always grounded in the entity's
 * own name rather than a hand-maintained college list. Returns '' if the name
 * does not follow the family's naming shape.
 */
export function deriveResidentialCollegeNameBeforeAnchor(
  displayName: unknown,
  anchor: string,
): string {
  if (typeof displayName !== 'string') return '';
  const pattern = new RegExp(`^(.*?)\\s*(?:College\\s+)?${anchor}\\b`, 'i');
  const match = displayName.trim().match(pattern);
  return match?.[1]?.trim() || '';
}

export function deriveResidentialCollegeName(displayName: unknown): string {
  return deriveResidentialCollegeNameBeforeAnchor(displayName, 'Mellon');
}

export function buildResidentialCollegeGrantShortDescription(collegeName: string): string {
  return `Funds a senior research project or senior essay for ${collegeName} College students.`;
}

const RICHTER_FELLOWSHIP_DISPLAY_NAME_PATTERN =
  /^(.*?)\s*(?:College\s+)?Richter\b.*Fellowship\s*$/i;

/**
 * Unlike the Mellon family, a Richter family member is identified by its
 * displayName shape rather than by its current shortDescription: Berkeley's
 * short is not the shared boilerplate text at all (it is a scrape-boundary
 * section-header fragment, "Amounts and uses of grant funding: ..."), but it
 * still needs the same distinguishing per-college replacement as the other 12
 * verbatim-duplicate members.
 */
export function isRichterFellowshipFamilyDisplayName(displayName: unknown): boolean {
  if (typeof displayName !== 'string') return false;
  return RICHTER_FELLOWSHIP_DISPLAY_NAME_PATTERN.test(displayName.trim());
}

export function deriveRichterFellowshipCollegeName(displayName: unknown): string {
  return deriveResidentialCollegeNameBeforeAnchor(displayName, 'Richter');
}

export function buildRichterFellowshipShortDescription(collegeName: string): string {
  return `Funds a Richter Summer Fellowship for independent study and research by ${collegeName} College students.`;
}
