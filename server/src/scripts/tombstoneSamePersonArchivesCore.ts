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
  'no-live-row-for-the-lead' | 'several-live-rows-for-the-lead' | 'not-person-scoped';

const PERSON_SCOPED_ENTITY_TYPES = new Set(['FACULTY_RESEARCH_AREA', 'INDIVIDUAL_RESEARCH']);

/**
 * Points each person-scoped row that was archived with no survivor and no recorded reason
 * at the one live row its lead key reaches (#4696).
 *
 * Without the pointer nothing resolves the survivor over the archived row's evidence, so a
 * person listed by two department rosters kept only one roster's profile and department,
 * and the archived slug answered 404. A row whose lead reaches several live rows is held,
 * because the key no longer says which one it duplicates, and so is a row that is not a
 * person's own research: a program or an organization is not the lead's duplicate.
 */
export function planSamePersonArchiveTombstones(input: {
  rows: readonly SamePersonArchiveRow[];
  leadKeysBySlug: ReadonlyMap<string, readonly string[]>;
}): {
  tombstones: SamePersonArchiveTombstone[];
  held: Array<{ slug: string; reason: SamePersonArchiveHold }>;
} {
  const liveSlugsByKey = new Map<string, Set<string>>();
  const bySlug = new Map(input.rows.map((row) => [row.slug, row]));
  for (const row of input.rows) {
    if (row.archived) continue;
    for (const key of input.leadKeysBySlug.get(row.slug) ?? []) {
      if (!liveSlugsByKey.has(key)) liveSlugsByKey.set(key, new Set());
      liveSlugsByKey.get(key)!.add(row.slug);
    }
  }
  const tombstones: SamePersonArchiveTombstone[] = [];
  const held: Array<{ slug: string; reason: SamePersonArchiveHold }> = [];
  for (const row of input.rows) {
    if (!row.archived || row.canonicalGroupId || (row.archivedReason ?? '').trim()) continue;
    const keys = input.leadKeysBySlug.get(row.slug) ?? [];
    if (keys.length === 0) continue;
    if (!PERSON_SCOPED_ENTITY_TYPES.has((row.entityType ?? '').toUpperCase())) {
      held.push({ slug: row.slug, reason: 'not-person-scoped' });
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
  return { tombstones, held };
}
