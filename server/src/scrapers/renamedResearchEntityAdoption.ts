import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { slugNamesPersonByFullName } from '../services/directoryRemovalSlugNames';
import { currentDirectoryRemovalMintGuard } from '../services/directoryRemovalMintGuard';

/**
 * The live row a lane key's own stored observations name by id, when no row holds the key
 * as its slug. A row renamed by `directory-removal:reslug` keeps no alias or redirect, so its
 * old key reaches it only through the `entityId` that migration and ingest stamp onto the
 * key's observations (#4160). Exactly one live row must be named, or nothing is adopted.
 */
export async function liveResearchEntityNamedByKeyObservations(
  entityKey: string | undefined,
  select = '_id',
): Promise<Record<string, unknown> | null> {
  if (!entityKey || mongoose.connection.readyState !== 1) return null;
  const ids = await Observation.distinct('entityId', {
    entityType: 'researchEntity',
    entityKey,
    entityId: { $ne: null },
  });
  if (ids.length === 0) return null;
  const rows = await ResearchEntity.find({ _id: { $in: ids }, archived: { $ne: true } })
    .select(select)
    .limit(2)
    .lean<Array<Record<string, unknown>>>();
  return rows.length === 1 ? rows[0] : null;
}

interface KeyedInput {
  entityType: string;
  entityKey?: string;
  entityId?: string;
}

const isKeyOnlyResearchEntityInput = (input: KeyedInput): boolean =>
  input.entityType === 'researchEntity' && Boolean(input.entityKey) && !input.entityId;

/**
 * Stamps the renamed row's id onto a lane's fresh old-key observations at ingest, so the
 * link from the old key to the row lives in the key's live observations rather than only in
 * the ones `directory-removal:reslug` stamped, which the next pass supersedes and pruning can
 * delete (#4160). A key some row holds as its slug is never touched.
 */
export async function withRenamedResearchEntityIds<T extends KeyedInput>(
  inputs: readonly T[],
): Promise<T[]> {
  const keys = [
    ...new Set(inputs.filter(isKeyOnlyResearchEntityInput).map((input) => input.entityKey!)),
  ];
  if (keys.length === 0 || mongoose.connection.readyState !== 1) return [...inputs];
  const held = new Set(
    (
      await ResearchEntity.find({ slug: { $in: keys } })
        .select('slug')
        .lean<Array<{ slug: string }>>()
    ).map((row) => row.slug),
  );
  const unheld = keys.filter((key) => !held.has(key));
  if (unheld.length === 0) return [...inputs];
  const named = await Observation.aggregate<{ _id: string; ids: unknown[] }>([
    {
      $match: { entityType: 'researchEntity', entityKey: { $in: unheld }, entityId: { $ne: null } },
    },
    { $group: { _id: '$entityKey', ids: { $addToSet: '$entityId' } } },
  ]);
  const namedIds = named.flatMap((group) => group.ids);
  if (namedIds.length === 0) return [...inputs];
  const live = new Set(
    (
      await ResearchEntity.find({ _id: { $in: namedIds }, archived: { $ne: true } })
        .select('_id')
        .lean<Array<{ _id: unknown }>>()
    ).map((row) => String(row._id)),
  );
  const rowIdByKey = new Map<string, string>();
  for (const group of named) {
    const liveIds = [...new Set(group.ids.map(String))].filter((id) => live.has(id));
    if (liveIds.length === 1) rowIdByKey.set(group._id, liveIds[0]);
  }
  return inputs.map((input) =>
    isKeyOnlyResearchEntityInput(input) && rowIdByKey.has(input.entityKey!)
      ? { ...input, entityId: rowIdByKey.get(input.entityKey!) }
      : input,
  );
}

export async function liveResearchEntityIdForLaneKey(entityKey: string): Promise<unknown> {
  const held = await ResearchEntity.findOne({ slug: entityKey, archived: { $ne: true } })
    .select('_id')
    .lean<{ _id: unknown } | null>();
  return held?._id ?? (await liveResearchEntityNamedByKeyObservations(entityKey))?._id ?? null;
}

export async function researchEntityMintSlugNamesARemovedResearcher(
  slug: unknown,
): Promise<boolean> {
  const guard = await currentDirectoryRemovalMintGuard();
  if (!guard.active) return false;
  const names = await guard.removedResearcherNames();
  const refused = names.some((name) => slugNamesPersonByFullName(slug, name));
  if (refused) guard.recordRefusal();
  return refused;
}
