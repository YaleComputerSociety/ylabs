/**
 * Field-scoped backfill for issue #1451: `researchAreas[]` entries that just
 * restate one of the entity's own `departments[]` are department leakage into
 * the topic-chip vocabulary, not a real research topic. The write-time
 * canonicalizer now keeps the two vocabularies disjoint going forward
 * (`applyResearchEntityResearchAreaCanonicalization`); this script strips the
 * same duplicates from existing `student_ready` rows without a full
 * `materializeEntity` re-run, which would drop unbacked fields.
 *
 * Dry-run by default; `--apply` writes and re-syncs changed entities to
 * Meilisearch. Refuses to apply unless `MONGODBURL` points at `/Development`.
 */
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { researchAreaMatchKey } from '../scrapers/researchAreaCanonicalization';
import { syncEntities } from '../services/meiliSyncService';

const __filename = fileURLToPath(import.meta.url);

interface EntityPlan {
  slug: string;
  id: string;
  before: string[];
  departments: string[];
  after: string[];
  removed: string[];
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export function planForEntity(
  slug: string,
  id: string,
  researchAreas: unknown,
  departments: unknown,
): EntityPlan | null {
  const before = asStringArray(researchAreas);
  const departmentList = asStringArray(departments);
  const departmentKeys = new Set(
    departmentList.map((department) => researchAreaMatchKey(department)).filter(Boolean),
  );
  if (departmentKeys.size === 0) return null;

  const removed: string[] = [];
  const after = before.filter((area) => {
    const isDepartmentDuplicate = departmentKeys.has(researchAreaMatchKey(area));
    if (isDepartmentDuplicate) removed.push(area);
    return !isDepartmentDuplicate;
  });
  if (removed.length === 0) return null;

  return { slug, id, before, departments: departmentList, after, removed };
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const url = process.env.MONGODBURL;
  if (!url) {
    console.error('MONGODBURL is not set');
    process.exit(1);
  }
  const pathname = new URL(url).pathname;
  if (apply && pathname !== '/Development') {
    console.error(`Refusing to apply: MONGODBURL points at ${pathname}, not /Development`);
    process.exit(1);
  }

  await mongoose.connect(url);
  const collection = mongoose.connection.collection('research_entities');
  console.log(`mode: ${apply ? 'APPLY' : 'DRY-RUN'} | db: ${pathname}`);

  const cursor = collection.find<{
    _id: unknown;
    slug?: string;
    researchAreas?: unknown;
    departments?: unknown;
  }>(
    { studentVisibilityTier: 'student_ready', researchAreas: { $exists: true, $ne: [] } },
    { projection: { slug: 1, researchAreas: 1, departments: 1 } },
  );

  const plans: EntityPlan[] = [];
  for await (const doc of cursor) {
    const id = String(doc._id);
    const plan = planForEntity(doc.slug ?? id, id, doc.researchAreas, doc.departments);
    if (plan) plans.push(plan);
  }

  const degenerate = plans.filter((plan) => plan.after.length === 0);

  console.log(`\nstudent_ready rows with a department-duplicate researchArea chip: ${plans.length}`);
  console.log(`of those, left with zero researchAreas after the strip (degenerate): ${degenerate.length}`);
  for (const plan of plans) {
    console.log(`\n[${plan.slug}]`);
    console.log(`  departments: ${JSON.stringify(plan.departments)}`);
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

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
