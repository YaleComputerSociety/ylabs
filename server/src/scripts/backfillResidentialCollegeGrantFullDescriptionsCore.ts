export {
  deriveResidentialCollegeName,
  deriveRichterFellowshipCollegeName,
  isRichterFellowshipFamilyDisplayName,
} from './backfillResidentialCollegeGrantShortDescriptionsCore';

/**
 * Detects a non-distinguishing fullDescription shared verbatim (modulo minor
 * wording drift, e.g. "off-set"/"offset" or a differing "by <date>" deadline
 * clause) across the Mellon Senior Research Grant family (#1557 reopened,
 * fullDescription residual). Every member of the family carries a fully
 * matching pattern, so - unlike the Richter family below - content-signature
 * detection alone is sufficient; a displayName-shape check is not needed.
 */
const MELLON_GRANT_FULL_BOILERPLATE_PATTERN =
  /to provide funding to off-?set the costs associated with a senior research project/i;

export function isResidentialCollegeGrantBoilerplateFullDescription(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return MELLON_GRANT_FULL_BOILERPLATE_PATTERN.test(value.trim());
}

/**
 * Distinguishing fullDescription for a Mellon Senior Research Grant entity,
 * grounded in the entity's own residential college. Retains every funding-
 * mechanics fact in the shared boilerplate (off-sets senior research/essay
 * costs, must occur during the academic year, presented to the Senior Mellon
 * Forum or another educational forum in the college) and adds the eligibility
 * gate the shared text omitted: only that college's own students qualify.
 * Deliberately never restates the entity's exact program title (some family
 * members are named "Mellon Research Fellowship for Seniors" or "Mellon
 * Research Grant" rather than "Mellon Senior Research Grant"), mirroring the
 * same title-agnostic phrasing #1597 used for the shortDescription fix.
 */
export function buildResidentialCollegeGrantFullDescription(collegeName: string): string {
  return (
    `Funds a senior research project or senior essay for ${collegeName} College students, to ` +
    `off-set costs incurred during the academic year. Awardees present the results of their ` +
    `research to the Senior Mellon Forum or another educational forum in ${collegeName} College. ` +
    `Only ${collegeName} College students are eligible; seniors at other residential colleges must ` +
    `apply through their own college's Mellon grant.`
  );
}

/**
 * Distinguishing fullDescription for a Richter Summer Fellowship entity,
 * grounded in the entity's own residential college. Retains every funding-
 * mechanics fact in the shared boilerplate (independent study/research only,
 * $1,500 award cap, taxable as IRS income, ordinarily juniors with first-
 * years/sophomores/graduate affiliates also eligible and seniors excluded,
 * consult the Head of College on significant project changes) and adds the
 * eligibility gate the shared text omitted: only that college's own students
 * qualify. Applied family-wide by displayName shape (mirrors the
 * shortDescription fix), since the one member without the exact shared text -
 * Berkeley - carries a different but equally non-distinguishing
 * administrative guidelines dump rather than a malformed fragment.
 * Deliberately never restates the entity's exact program title (some family
 * members are named "Richter Fellowship" rather than "Richter Summer
 * Fellowship"), mirroring the same title-agnostic phrasing #1597 used for the
 * shortDescription fix.
 */
export function buildRichterFellowshipFullDescription(collegeName: string): string {
  return (
    `Funds a Richter Summer Fellowship for independent study and research by ${collegeName} ` +
    `College students - not mere travel, work, or enrollment in a school; an internship qualifies ` +
    `only if its primary component is study or research, and being part of a research team is a ` +
    `valid use. The award is capped at $1,500 and is reported to the IRS as taxable income. Richter ` +
    `Fellowships are ordinarily awarded to juniors, though first-years, sophomores, and graduate ` +
    `affiliates are also eligible; seniors are not eligible. Awardees must promptly consult the ` +
    `Head of ${collegeName} College if significant changes occur in their project. Only ` +
    `${collegeName} College students are eligible; students at other residential colleges must ` +
    `apply through their own college's Richter Fellowship.`
  );
}
