import 'dotenv/config';
import mongoose from 'mongoose';
import {
  isCorruptResearchAreaLabel,
  sanitizeResearchAreaLabelList,
} from '../utils/researchAreaLabelHygiene';
import { syncEntities } from '../services/meiliSyncService';

interface EntityPlan {
  slug: string;
  id: string;
  before: string[];
  after: string[];
  removed: string[];
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function planForEntity(slug: string, id: string, researchAreas: unknown): EntityPlan | null {
  const before = asStringArray(researchAreas);
  if (!before.some(isCorruptResearchAreaLabel)) return null;
  const after = sanitizeResearchAreaLabelList(before);
  const afterSet = new Set(after.map((v) => v.toLowerCase()));
  const removed = before.filter((v) => !afterSet.has(v.toLowerCase()));
  return { slug, id, before, after, removed };
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
  const collection = mongoose.connection.collection('research_entities');
  console.log(`mode: ${apply ? 'APPLY' : 'DRY-RUN'} | db: ${pathname}`);

  const cursor = collection.find<{ _id: unknown; slug?: string; researchAreas?: unknown }>(
    { researchAreas: { $exists: true, $ne: [] } },
    { projection: { slug: 1, researchAreas: 1 } },
  );

  const plans: EntityPlan[] = [];
  for await (const doc of cursor) {
    const id = String(doc._id);
    const plan = planForEntity(doc.slug ?? id, id, doc.researchAreas);
    if (plan) plans.push(plan);
  }

  console.log(`\ncandidates with corrupt researchArea chips: ${plans.length}`);
  for (const plan of plans) {
    console.log(`\n[${plan.slug}]`);
    console.log(`  before (${plan.before.length}): ${JSON.stringify(plan.before)}`);
    console.log(`  removed (${plan.removed.length}): ${JSON.stringify(plan.removed)}`);
    console.log(`  after  (${plan.after.length}): ${JSON.stringify(plan.after)}`);
  }

  if (apply && plans.length > 0) {
    for (const plan of plans) {
      await collection.updateOne(
        { _id: new mongoose.Types.ObjectId(plan.id) },
        { $set: { researchAreas: plan.after } },
      );
    }
    const ids = plans.map((p) => new mongoose.Types.ObjectId(p.id));
    const updatedDocs = await collection.find({ _id: { $in: ids } }).toArray();
    await syncEntities('researchEntity', updatedDocs);
    console.log(`\nAPPLIED to ${plans.length} entities and re-synced them to Meilisearch.`);
  } else if (!apply) {
    console.log('\ndry-run complete; re-run with --apply to write and re-sync.');
  }

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
