import 'dotenv/config';
import mongoose from 'mongoose';
import { ResearchEntity } from '../models/researchEntity';
import { syncEntities } from '../services/meiliSyncService';
import {
  fullDescriptionQuality,
  shortDescriptionQuality,
} from '../utils/researchEntityDescriptionQuality';

interface RepairPlan {
  id: string;
  slug: string;
  unsetFullDescription: boolean;
  unsetShortDescription: boolean;
}

const EMPTY_FACET_FILTER = {
  entityType: 'FACULTY_RESEARCH_AREA',
  archived: { $ne: true },
  $and: [
    { $or: [{ departments: { $exists: false } }, { departments: { $size: 0 } }] },
    { $or: [{ researchAreas: { $exists: false } }, { researchAreas: { $size: 0 } }] },
  ],
};

async function buildPlans(): Promise<RepairPlan[]> {
  const entities = await ResearchEntity.find(EMPTY_FACET_FILTER)
    .select('_id slug shortDescription fullDescription')
    .lean();

  const plans: RepairPlan[] = [];
  for (const entity of entities) {
    const fullDescription = String(entity.fullDescription || '');
    const shortDescription = String(entity.shortDescription || '');
    const fullQuality = fullDescriptionQuality(fullDescription);
    const shortQuality = shortDescriptionQuality(shortDescription, fullDescription);

    const unsetFullDescription = Boolean(fullDescription) && !fullQuality.isUseful;
    const unsetShortDescription = Boolean(shortDescription) && !shortQuality.isUseful;
    if (!unsetFullDescription && !unsetShortDescription) continue;

    plans.push({
      id: String(entity._id),
      slug: entity.slug,
      unsetFullDescription,
      unsetShortDescription,
    });
  }

  return plans;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  const url = process.env.MONGODBURL;
  if (!url) {
    console.error('MONGODBURL is not set');
    process.exit(1);
  }
  const pathname = new URL(url).pathname;
  if (pathname !== '/Development') {
    console.error(`Refusing to run: MONGODBURL points at ${pathname}, not /Development`);
    process.exit(1);
  }

  await mongoose.connect(url);
  console.log(`mode: ${apply ? 'APPLY' : 'DRY-RUN'} | db: ${pathname}`);

  const plans = await buildPlans();
  console.log(`\nFACULTY_RESEARCH_AREA rows with empty departments+researchAreas whose stored`);
  console.log(`description is not a useful research summary: ${plans.length}`);
  for (const plan of plans) {
    const cleared = [
      plan.unsetFullDescription && 'fullDescription',
      plan.unsetShortDescription && 'shortDescription',
    ].filter(Boolean);
    console.log(`  [${plan.slug}] clear: ${cleared.join(', ')}`);
  }

  if (apply && plans.length > 0) {
    for (const plan of plans) {
      const unset: Record<string, ''> = {};
      if (plan.unsetFullDescription) unset.fullDescription = '';
      if (plan.unsetShortDescription) unset.shortDescription = '';
      await ResearchEntity.updateOne({ _id: plan.id }, { $unset: unset });
    }
    const updatedIds = plans.map((plan) => plan.id);
    const updatedDocs = await ResearchEntity.find({ _id: { $in: updatedIds } }).lean();
    await syncEntities('researchEntity', updatedDocs);
    console.log(`\napplied and synced ${updatedDocs.length} entities to Meili`);
  }
}

main()
  .catch((error) => {
    console.error('Failed to repair FRA empty-facet descriptions:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
