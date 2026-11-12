import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { mongooseConnectionWasOpened } from '../utils/mongooseConnectionWasOpened';

/**
 * A change to the roster name normalizer changes the key a roster mints from a name, and
 * without this the next read would mint a second row under the new key and strand the row
 * the old key holds (#5969). The lane derives the entry's key under the previous normalizer
 * version and keeps writing to that row, through its id, when exactly one row answers to it
 * from this lane, for this roster, for this person. Nothing is renamed, written directly or
 * deleted; the old key simply stays the row's key.
 */

const ROSTER_SOURCE = 'dept-faculty-roster';

export interface LegacyKeyRows {
  liveRowIds: string[];
  rosterOwnerKeys: string[];
  readByThisLane: boolean;
}

export type LegacyKeyRowsBySlug = ReadonlyMap<string, LegacyKeyRows>;
export type LegacyKeyRowLoader = (slugs: string[]) => Promise<LegacyKeyRowsBySlug>;

export type LegacyKeyAdoption =
  | { kind: 'none' }
  | { kind: 'adopt'; legacySlug: string; entityId: string; ownerKey: string }
  | {
      kind: 'refuse';
      legacySlug: string;
      reason: 'several-rows' | 'another-source' | 'different-person';
    };

export function decideLegacyKeyAdoption(input: {
  currentSlug: string;
  legacySlug: string;
  ownerKey: string;
  legacyOwnerKey: string;
  rowsBySlug: LegacyKeyRowsBySlug;
}): LegacyKeyAdoption {
  const { currentSlug, legacySlug } = input;
  if (!legacySlug || !currentSlug || legacySlug === currentSlug) return { kind: 'none' };
  if ((input.rowsBySlug.get(currentSlug)?.liveRowIds.length ?? 0) > 0) return { kind: 'none' };
  const legacy = input.rowsBySlug.get(legacySlug);
  if (!legacy || legacy.liveRowIds.length === 0) return { kind: 'none' };
  if (legacy.liveRowIds.length > 1) return { kind: 'refuse', legacySlug, reason: 'several-rows' };
  if (!legacy.readByThisLane) return { kind: 'refuse', legacySlug, reason: 'another-source' };
  const owners = new Set(legacy.rosterOwnerKeys);
  const ownerKey = [input.ownerKey, input.legacyOwnerKey].find((key) => owners.has(key));
  if (!ownerKey) return { kind: 'refuse', legacySlug, reason: 'different-person' };
  return { kind: 'adopt', legacySlug, entityId: legacy.liveRowIds[0], ownerKey };
}

/**
 * The live rows each key reaches, by slug and by the row id this lane's observations under
 * that key carry, and the person keys this lane read the key's row under.
 */
export async function loadLegacyKeyRows(slugs: string[]): Promise<Map<string, LegacyKeyRows>> {
  const wanted = [...new Set(slugs.filter(Boolean))];
  const bySlug = new Map<string, LegacyKeyRows>();
  if (wanted.length === 0 || !mongooseConnectionWasOpened()) return bySlug;
  const [rowsBySlugDocs, laneObservations] = await Promise.all([
    ResearchEntity.find(
      { slug: { $in: wanted }, archived: { $ne: true } },
      { _id: 1, slug: 1 },
    ).lean(),
    Observation.find(
      {
        entityType: 'researchEntity',
        entityKey: { $in: wanted },
        sourceName: ROSTER_SOURCE,
        superseded: false,
        field: { $in: ['slug', 'inferredPiUserKey'] },
      },
      { entityKey: 1, entityId: 1, field: 1, value: 1 },
    ).lean(),
  ]);
  const stampedIds = [
    ...new Set(
      (laneObservations as Array<{ entityId?: unknown }>)
        .map((observation) => (observation.entityId ? String(observation.entityId) : ''))
        .filter((id) => mongoose.Types.ObjectId.isValid(id)),
    ),
  ];
  const liveStamped = new Set(
    stampedIds.length
      ? (
          (await ResearchEntity.find(
            { _id: { $in: stampedIds }, archived: { $ne: true } },
            { _id: 1 },
          ).lean()) as Array<{ _id: unknown }>
        ).map((row) => String(row._id))
      : [],
  );
  const entry = (slug: string): LegacyKeyRows => {
    const held = bySlug.get(slug) ?? { liveRowIds: [], rosterOwnerKeys: [], readByThisLane: false };
    bySlug.set(slug, held);
    return held;
  };
  for (const row of rowsBySlugDocs as Array<{ _id: unknown; slug?: string }>) {
    if (row.slug) entry(row.slug).liveRowIds.push(String(row._id));
  }
  for (const observation of laneObservations as Array<{
    entityKey?: string;
    entityId?: unknown;
    field?: string;
    value?: unknown;
  }>) {
    if (!observation.entityKey) continue;
    const held = entry(observation.entityKey);
    held.readByThisLane = true;
    const stamped = observation.entityId ? String(observation.entityId) : '';
    if (stamped && liveStamped.has(stamped) && !held.liveRowIds.includes(stamped)) {
      held.liveRowIds.push(stamped);
    }
    if (observation.field === 'inferredPiUserKey' && typeof observation.value === 'string') {
      if (!held.rosterOwnerKeys.includes(observation.value))
        held.rosterOwnerKeys.push(observation.value);
    }
  }
  return bySlug;
}
