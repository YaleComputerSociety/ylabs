import { titleResearchOwnership } from '../scrapers/utils/titleResearchOwnership';

export const LEAD_TITLE_PENDING_POLICY_REASON = 'lead_title_pending_policy';

// Ranks the owner has not yet ruled on for "can they host a student's research"
// (2026-10-04). A ruling moves a rank out of this list: to the retirement stage's
// non-hosting ranks, or off the list entirely so the row serves again.
const RANKS_PENDING_POLICY =
  /\bstaff affiliate\b|\bclinical fellow\b|\bhospital resident\b|\bpostgraduate associate\b/i;

const titleOf = (member: Record<string, any>): string => {
  const title = member?.title ?? member?.user?.title;
  return typeof title === 'string' ? title.trim() : '';
};

/**
 * Whether every lead on the row states only a rank awaiting the owner's ruling. A lead
 * with no stated title, or one holding any rank that owns research beside it, is not
 * evidence for the hold.
 */
export function leadTitlesArePendingPolicy(
  leadMembers: ReadonlyArray<Record<string, any>>,
): boolean {
  if (leadMembers.length === 0) return false;
  return leadMembers.every((member) => {
    const title = titleOf(member);
    return (
      title !== '' &&
      RANKS_PENDING_POLICY.test(title) &&
      titleResearchOwnership(title) === 'works_in_another_group'
    );
  });
}
