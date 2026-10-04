import { SAME_PERSON_ARCHIVE_TOMBSTONE_REASON } from '../models/entityArchival';
import { isPersonScopedResearchEntityType } from '../models/storedVocabularies';

export interface SamePersonArchiveRow {
  id: string;
  slug: string;
  archived: boolean;
  entityType?: string;
  canonicalGroupId?: string | null;
  archivedReason?: string;
}

export interface SamePersonArchiveTombstone {
  archivedId: string;
  archivedSlug: string;
  survivorId: string;
  survivorSlug: string;
}

export type SamePersonArchiveHold =
  | 'no-live-row-for-the-lead'
  | 'several-live-rows-for-the-lead'
  | 'lab-is-not-a-profile-duplicate'
  | 'not-person-scoped';

function entityTypeOf(row: SamePersonArchiveRow): string {
  return (row.entityType ?? '').trim().toUpperCase();
}

function isNonLabPersonScoped(row: SamePersonArchiveRow): boolean {
  const entityType = entityTypeOf(row);
  return entityType !== 'LAB' && isPersonScopedResearchEntityType(entityType);
}

/**
 * Points each person-scoped row that was archived with no survivor and no recorded reason
 * at the one live row its lead key reaches (#4696).
 *
 * Without the pointer nothing resolves the survivor over the archived row's evidence, so a
 * person listed by two department rosters kept only one roster's profile and department,
 * and the archived slug answered 404. A row whose lead reaches several live rows is held,
 * because the key no longer says which one it duplicates, and so is a row that is not a
 * person's own research: a program or an organization is not the lead's duplicate. A lab is
 * held too, and never chosen as a survivor, because a lead legitimately owns both a lab and
 * a profile, so sharing a lead key does not make one the other's duplicate.
 *
 * `resumedSurvivorIds` names the live survivors of archives an earlier run already pointed,
 * so a run that died after pointing still has those survivors re-materialized and re-gated.
 */
export function planSamePersonArchiveTombstones(input: {
  rows: readonly SamePersonArchiveRow[];
  leadKeysBySlug: ReadonlyMap<string, readonly string[]>;
}): {
  tombstones: SamePersonArchiveTombstone[];
  held: Array<{ slug: string; reason: SamePersonArchiveHold }>;
  resumedSurvivorIds: string[];
} {
  const liveSlugsByKey = new Map<string, Set<string>>();
  const bySlug = new Map(input.rows.map((row) => [row.slug, row]));
  const liveIds = new Set(input.rows.filter((row) => !row.archived).map((row) => row.id));
  const resumedSurvivorIds = new Set<string>();
  for (const row of input.rows) {
    if (row.archived || !isNonLabPersonScoped(row)) continue;
    for (const key of input.leadKeysBySlug.get(row.slug) ?? []) {
      if (!liveSlugsByKey.has(key)) liveSlugsByKey.set(key, new Set());
      liveSlugsByKey.get(key)!.add(row.slug);
    }
  }
  const tombstones: SamePersonArchiveTombstone[] = [];
  const held: Array<{ slug: string; reason: SamePersonArchiveHold }> = [];
  for (const row of input.rows) {
    if (
      row.archived &&
      row.canonicalGroupId &&
      row.archivedReason === SAME_PERSON_ARCHIVE_TOMBSTONE_REASON &&
      liveIds.has(row.canonicalGroupId)
    ) {
      resumedSurvivorIds.add(row.canonicalGroupId);
    }
    if (!row.archived || row.canonicalGroupId || (row.archivedReason ?? '').trim()) continue;
    const keys = input.leadKeysBySlug.get(row.slug) ?? [];
    if (keys.length === 0) continue;
    if (!isNonLabPersonScoped(row)) {
      held.push({
        slug: row.slug,
        reason: entityTypeOf(row) === 'LAB' ? 'lab-is-not-a-profile-duplicate' : 'not-person-scoped',
      });
      continue;
    }
    const live = new Set(keys.flatMap((key) => [...(liveSlugsByKey.get(key) ?? [])]));
    if (live.size === 0) {
      held.push({ slug: row.slug, reason: 'no-live-row-for-the-lead' });
      continue;
    }
    if (live.size > 1) {
      held.push({ slug: row.slug, reason: 'several-live-rows-for-the-lead' });
      continue;
    }
    const survivor = bySlug.get([...live][0])!;
    tombstones.push({
      archivedId: row.id,
      archivedSlug: row.slug,
      survivorId: survivor.id,
      survivorSlug: survivor.slug,
    });
  }
  return { tombstones, held, resumedSurvivorIds: [...resumedSurvivorIds] };
}
