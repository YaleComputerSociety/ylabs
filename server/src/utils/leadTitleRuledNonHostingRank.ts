import { titleResearchOwnership } from '../scrapers/utils/titleResearchOwnership';

export const LEAD_TITLE_RULED_NON_HOSTING_RANK_REASON = 'lead_title_ruled_non_hosting_rank';

// Ranks the owner ruled cannot host a student's research (2026-10-04). The retirement
// stage archives the rows these ranks lead, but it refuses on any doubt because an
// archive is irreversible, so the rows it refuses are held here rather than served.
const RULED_NON_HOSTING_RANKS =
  /\bstaff affiliate\b|\bclinical fellow\b|\bhospital resident\b|\bpostgraduate associate\b/i;

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const titleOf = (member: Record<string, any>): string =>
  textValue(member?.title) || textValue(member?.user?.title);

/**
 * Whether every lead on the row states only a rank the owner ruled cannot host. A lead
 * with no stated title, or one holding any rank that owns research beside it, is not
 * evidence for the hold.
 */
export function leadTitlesAreRuledNonHostingRanks(
  leadMembers: ReadonlyArray<Record<string, any>>,
): boolean {
  if (leadMembers.length === 0) return false;
  return leadMembers.every((member) => {
    const title = titleOf(member);
    return (
      title !== '' &&
      RULED_NON_HOSTING_RANKS.test(title) &&
      titleResearchOwnership(title) === 'works_in_another_group'
    );
  });
}
