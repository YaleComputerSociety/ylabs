import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { numberedSlugCandidate } from '../services/directoryRemovalSlugNames';
import {
  addIndexSyncOutcomes,
  NO_INDEX_SYNC,
  syncResearchEntitiesWithOutcome,
  type IndexSyncOutcome,
} from '../services/researchEntityIndexSyncOutcome';

const MAX_SLUG_ATTEMPTS = 50;

export interface ResearchEntityReslugPlan {
  entityId: mongoose.Types.ObjectId;
  fromSlug: string;
  toSlug: string;
}

/**
 * Opt-in only. A reslug made for privacy (#4160) must leave no trail from the old slug to
 * the row, so it passes no redirect at all; a reslug that only corrects a bad slug records
 * the old one so its public URL keeps answering (#5808).
 */
export interface ResearchEntityReslugRedirect {
  reason: string;
  renamedAt: Date;
}

export const keylessResearchEntityObservationsOf = (slug: string) => ({
  entityType: 'researchEntity' as const,
  entityKey: slug,
  entityId: null,
});

async function slugIsTaken(slug: string, reserved: ReadonlySet<string>): Promise<boolean> {
  if (reserved.has(slug)) return true;
  const heldByARow = await ResearchEntity.exists({
    $or: [{ slug }, { 'mergedFrom.slug': slug }, { 'previousSlugs.slug': slug }],
  });
  if (heldByARow) return true;
  return Boolean(await Observation.exists({ entityType: 'researchEntity', entityKey: slug }));
}

export async function firstFreeResearchEntitySlug(
  base: string,
  reserved: ReadonlySet<string>,
  scriptName: string,
): Promise<string> {
  for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt += 1) {
    const candidate = numberedSlugCandidate(base, attempt);
    if (!(await slugIsTaken(candidate, reserved))) return candidate;
  }
  throw new Error(`${scriptName} found no free numbered slug after ${MAX_SLUG_ATTEMPTS} tries.`);
}

/**
 * Stamps the row's id onto its old key's keyless observations, marked `reslugAdoption`, so
 * lane evidence still stored under the old key reaches the row and an archived row is not
 * re-minted at the old key (#4160, #5726), then renames the row.
 */
export async function applyResearchEntityReslug(
  plan: ResearchEntityReslugPlan,
  redirect?: ResearchEntityReslugRedirect,
): Promise<{ stamped: number; renamed: number }> {
  const stamped = await Observation.updateMany(keylessResearchEntityObservationsOf(plan.fromSlug), {
    $set: { entityId: plan.entityId, reslugAdoption: true },
  });
  const rename: Record<string, unknown> = { $set: { slug: plan.toSlug } };
  if (redirect) {
    rename.$push = {
      previousSlugs: {
        slug: plan.fromSlug,
        renamedAt: redirect.renamedAt,
        reason: redirect.reason,
      },
    };
  }
  const renamed = await ResearchEntity.updateOne(
    { _id: plan.entityId, slug: plan.fromSlug, archived: { $ne: true } },
    rename,
  );
  return { stamped: stamped.modifiedCount, renamed: renamed.matchedCount };
}

export async function resyncRenamedResearchEntities(
  renamedIds: readonly mongoose.Types.ObjectId[],
): Promise<IndexSyncOutcome> {
  if (renamedIds.length === 0) return NO_INDEX_SYNC;
  return addIndexSyncOutcomes(
    NO_INDEX_SYNC,
    await syncResearchEntitiesWithOutcome(
      await ResearchEntity.find({ _id: { $in: [...renamedIds] } }).lean(),
    ),
  );
}
