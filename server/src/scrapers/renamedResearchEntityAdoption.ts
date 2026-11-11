import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { slugNamesPersonByFullName } from '../services/directoryRemovalSlugNames';
import { currentDirectoryRemovalMintGuard } from '../services/directoryRemovalMintGuard';

// Raw collection on purpose: importing the ResearchEntity model here would register it on
// the ingest path and auto-build its unique slug index on a default connection (#5716).
// Guarded by observationStoreWithoutResearchEntityModel.integration.test.ts.
const researchEntities = () => mongoose.connection.db!.collection('research_entities');

const projectionOf = (select: string): Record<string, 1> =>
  Object.fromEntries(
    select
      .split(/\s+/)
      .filter(Boolean)
      .map((field) => [field, 1]),
  );

/**
 * The live row a lane key's own stored observations name by id, when no row holds the key
 * as its slug. A row renamed by `directory-removal:reslug` keeps no alias or redirect, so its
 * old key reaches it only through the `entityId` that migration and ingest stamp onto the
 * key's observations (#4160). Exactly one live row must be named, or nothing is adopted.
 *
 * A row renamed with a redirect also lists the old key in `previousSlugs` (#5808), which
 * outlives the stamped observations, so the key still reaches it once those are pruned.
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
  if (ids.length === 0) return liveResearchEntityListingPreviousSlug(entityKey, select);
  const rows = await researchEntities()
    .find({ _id: { $in: ids }, archived: { $ne: true } }, { projection: projectionOf(select) })
    .limit(2)
    .toArray();
  return rows.length === 1 ? rows[0] : null;
}

async function liveResearchEntityListingPreviousSlug(
  entityKey: string,
  select: string,
): Promise<Record<string, unknown> | null> {
  const rows = await researchEntities()
    .find(
      { 'previousSlugs.slug': entityKey, archived: { $ne: true } },
      { projection: projectionOf(select) },
    )
    .limit(2)
    .toArray();
  return rows.length === 1 ? rows[0] : null;
}

interface KeyedInput {
  entityType: string;
  entityKey?: string;
  entityId?: string;
  reslugAdoption?: boolean;
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
      await researchEntities()
        .find({ slug: { $in: keys } }, { projection: { slug: 1 } })
        .toArray()
    ).map((row) => String(row.slug)),
  );
  const unheld = keys.filter((key) => !held.has(key));
  if (unheld.length === 0) return [...inputs];
  const named = await Observation.aggregate<{
    _id: string;
    ids: mongoose.Types.ObjectId[];
    reslugAdoptionIds: mongoose.Types.ObjectId[];
  }>([
    {
      $match: { entityType: 'researchEntity', entityKey: { $in: unheld }, entityId: { $ne: null } },
    },
    {
      $group: {
        _id: '$entityKey',
        ids: { $addToSet: '$entityId' },
        reslugAdoptionIds: {
          $addToSet: { $cond: [{ $eq: ['$reslugAdoption', true] }, '$entityId', '$$REMOVE'] },
        },
      },
    },
  ]);
  const namedIds = named.flatMap((group) => group.ids);
  if (namedIds.length === 0) return [...inputs];
  const live = new Set(
    (
      await researchEntities()
        .find({ _id: { $in: namedIds }, archived: { $ne: true } }, { projection: { _id: 1 } })
        .toArray()
    ).map((row) => String(row._id)),
  );
  const stampByKey = new Map<string, { entityId: string; reslugAdoption: boolean }>();
  for (const group of named) {
    const liveIds = [...new Set(group.ids.map(String))].filter((id) => live.has(id));
    if (liveIds.length !== 1) continue;
    const reslugAdoption = group.reslugAdoptionIds.map(String).includes(liveIds[0]);
    stampByKey.set(group._id, { entityId: liveIds[0], reslugAdoption });
  }
  return inputs.map((input) => {
    const stamp = isKeyOnlyResearchEntityInput(input)
      ? stampByKey.get(input.entityKey!)
      : undefined;
    if (!stamp) return input;
    return stamp.reslugAdoption
      ? { ...input, entityId: stamp.entityId, reslugAdoption: true }
      : { ...input, entityId: stamp.entityId };
  });
}

export async function liveResearchEntityIdForLaneKey(entityKey: string): Promise<unknown> {
  if (mongoose.connection.readyState !== 1) return null;
  const held = await researchEntities().findOne(
    { slug: entityKey, archived: { $ne: true } },
    { projection: { _id: 1 } },
  );
  return held?._id ?? (await liveResearchEntityNamedByKeyObservations(entityKey))?._id ?? null;
}

/**
 * A key no row holds whose `directory-removal:reslug` stamps name only archived rows was
 * renamed away from, so it mints nothing: archiving the renamed row must not bring a new
 * row back at the old slug (#4160). Only the reslug's own stamps count, so a key whose
 * observations name an archived row for any other reason re-mints as before.
 */
export async function reslugAdoptedKeyNamesOnlyArchivedRows(
  entityKey: string | undefined,
): Promise<boolean> {
  if (!entityKey || mongoose.connection.readyState !== 1) return false;
  const ids = await Observation.distinct('entityId', {
    entityType: 'researchEntity',
    entityKey,
    entityId: { $ne: null },
    reslugAdoption: true,
  });
  if (ids.length === 0) return false;
  const [live, archived] = await Promise.all([
    researchEntities().findOne(
      { _id: { $in: ids }, archived: { $ne: true } },
      { projection: { _id: 1 } },
    ),
    researchEntities().findOne({ _id: { $in: ids }, archived: true }, { projection: { _id: 1 } }),
  ]);
  return !live && Boolean(archived);
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
