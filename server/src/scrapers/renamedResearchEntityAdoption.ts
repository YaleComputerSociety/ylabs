import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { slugNamesPersonByFullName } from '../services/directoryRemovalSlugNames';
import { currentDirectoryRemovalMintGuard } from '../services/directoryRemovalMintGuard';

/**
 * The live row a lane key's own stored observations name by id, when no row holds the key
 * as its slug. A row renamed by `directory-removal:reslug` keeps no alias or redirect, so its
 * old key reaches it only through the `entityId` that migration stamps onto the key's
 * observations (#4160). Exactly one live row must be named, or nothing is adopted.
 */
export async function liveResearchEntityNamedByKeyObservations(
  entityKey: string | undefined,
  select = '_id',
): Promise<Record<string, unknown> | null> {
  if (!entityKey) return null;
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
