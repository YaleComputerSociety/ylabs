import { MERGE_RELINKABLE_OBSERVATION_FIELDS } from './researchEntityPiDedupeCore';

/**
 * Merge the duplicate-URL groups whose members share a lead person AND carry something
 * that corroborates sameness beyond that shared lead (#3326).
 *
 * The shared lead is necessary and not sufficient, which is the whole boundary of this
 * lane. A lab member carries its lab's address as its own `websiteUrl`, so a shared URL
 * is consistent with a member row as well as with a duplicate (#3279). #3279 also
 * settled the layer question by building the alternative and reverting it: ownership
 * decides whether a shared URL is a duplicate CLAIM, never whether two rows are the same
 * ENTITY, where pooled person identity is the correct key.
 *
 * So corroboration is required, and only two kinds count:
 *
 *   - the normalized name also agrees, which is a proxy for a source naming both rows
 *     the same thing;
 *   - one member is a shell and the other is concrete, which also settles survivor choice
 *     because a shell never survives over a concrete row.
 *
 * Everything else is held, including every group whose only evidence is the shared URL
 * and the shared lead.
 */
export const SAME_LEAD_MERGE_CARRIED_FIELDS = MERGE_RELINKABLE_OBSERVATION_FIELDS;

export type SameLeadMergeHold =
  | 'a-member-has-no-lead-so-the-test-is-vacuous'
  | 'members-share-no-lead'
  | 'only-a-shared-url-and-a-shared-lead'
  | 'already-planned-by-the-url-identity-lane'
  | 'quarantined-by-the-conflation-guard'
  | 'no-ownership-evidence-on-either-side';

export type SameLeadCorroboration = 'name-agrees' | 'shell-versus-concrete';

export interface SameLeadMergeMember {
  id: string;
  slug: string;
  name: string;
  entityType?: string;
  hasIndexUrlAuthority: boolean;
  fundingRichness: number;
  isShell: boolean;
}

export interface SameLeadMergePlan {
  url: string;
  corroboration: SameLeadCorroboration;
  survivorId: string;
  loserIds: string[];
  survivorGainsFunding: boolean;
}

export interface SameLeadMergeOutcome {
  merges: SameLeadMergePlan[];
  held: Array<{ url: string; reason: SameLeadMergeHold }>;
}

const SHELL_SLUG = /^(?:nih|nsf|federal|doe|neh)-pi-|^faculty-research-area-/i;

export function isShellSlug(slug: string): boolean {
  return SHELL_SLUG.test(slug.trim());
}

/**
 * The comparable form of a research-home name. The kind nouns are dropped because
 * "Avery Lab" and "Avery Laboratory" are the same claim, and punctuation because one
 * source hyphenates where another does not.
 */
export function normalizedMergeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(?:lab|laboratory|research|faculty|group|the)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function corroborationFor(
  members: readonly SameLeadMergeMember[],
): SameLeadCorroboration | null {
  const names = members.map((member) => normalizedMergeName(member.name));
  if (names.every(Boolean) && new Set(names).size === 1) return 'name-agrees';
  const shells = members.filter((member) => member.isShell).length;
  if (shells > 0 && shells < members.length) return 'shell-versus-concrete';
  return null;
}

/**
 * The survivor, or null when the evidence does not choose one.
 *
 * Never incumbency. Whichever row currently serves is the least reliable signal in this
 * cohort: 17 of 25 genuine owners were the suppressed side, and every sampled group reads
 * one served and one dark. A concrete row beats a shell, then index-URL authority, then
 * funding richness. When none of those separates the members the group is HELD, because a
 * tie here breaks alphabetically 44.5% of the time and an alphabetical winner is not an
 * evidence-based one.
 */
export function survivorByOwnershipEvidence(
  members: readonly SameLeadMergeMember[],
): SameLeadMergeMember | null {
  const concrete = members.filter((member) => !member.isShell);
  const candidates = concrete.length > 0 && concrete.length < members.length ? concrete : members;
  if (candidates.length === 1) return candidates[0];

  const withAuthority = candidates.filter((member) => member.hasIndexUrlAuthority);
  if (withAuthority.length === 1) return withAuthority[0];
  const pool = withAuthority.length > 1 ? withAuthority : candidates;

  const best = Math.max(...pool.map((member) => member.fundingRichness));
  const richest = pool.filter((member) => member.fundingRichness === best);
  if (richest.length === 1 && best > 0) return richest[0];
  return null;
}

export function planSameLeadCorroboratedMerges(
  groups: ReadonlyArray<{
    url: string;
    members: readonly SameLeadMergeMember[];
    sharesALead: boolean;
    everyMemberHasALead: boolean;
    alreadyPlannedByUrlLane: boolean;
    quarantinedByConflationGuard: boolean;
  }>,
): SameLeadMergeOutcome {
  const merges: SameLeadMergePlan[] = [];
  const held: Array<{ url: string; reason: SameLeadMergeHold }> = [];

  for (const group of groups) {
    if (!group.everyMemberHasALead) {
      held.push({ url: group.url, reason: 'a-member-has-no-lead-so-the-test-is-vacuous' });
      continue;
    }
    if (!group.sharesALead) {
      held.push({ url: group.url, reason: 'members-share-no-lead' });
      continue;
    }
    // Excluded before any judgement of our own: the URL-identity lane already reaches
    // these, and its conflation guard has been right on every group anyone has read.
    if (group.alreadyPlannedByUrlLane) {
      held.push({ url: group.url, reason: 'already-planned-by-the-url-identity-lane' });
      continue;
    }
    if (group.quarantinedByConflationGuard) {
      held.push({ url: group.url, reason: 'quarantined-by-the-conflation-guard' });
      continue;
    }
    const corroboration = corroborationFor(group.members);
    if (!corroboration) {
      held.push({ url: group.url, reason: 'only-a-shared-url-and-a-shared-lead' });
      continue;
    }
    const survivor = survivorByOwnershipEvidence(group.members);
    if (!survivor) {
      held.push({ url: group.url, reason: 'no-ownership-evidence-on-either-side' });
      continue;
    }
    const losers = group.members.filter((member) => member.id !== survivor.id);
    merges.push({
      url: group.url,
      corroboration,
      survivorId: survivor.id,
      loserIds: losers.map((member) => member.id),
      survivorGainsFunding:
        survivor.fundingRichness === 0 && losers.some((member) => member.fundingRichness > 0),
    });
  }

  return { merges, held };
}

export function summarizeSameLeadMergeHolds(
  held: ReadonlyArray<{ reason: SameLeadMergeHold }>,
): Record<SameLeadMergeHold, number> {
  const counts: Record<SameLeadMergeHold, number> = {
    'a-member-has-no-lead-so-the-test-is-vacuous': 0,
    'members-share-no-lead': 0,
    'only-a-shared-url-and-a-shared-lead': 0,
    'already-planned-by-the-url-identity-lane': 0,
    'quarantined-by-the-conflation-guard': 0,
    'no-ownership-evidence-on-either-side': 0,
  };
  for (const row of held) counts[row.reason] += 1;
  return counts;
}
