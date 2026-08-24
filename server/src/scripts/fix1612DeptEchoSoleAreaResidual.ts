/**
 * Field-scoped backfill for issue #1612: a `student_ready` LAB or
 * FACULTY_RESEARCH_AREA row whose entire `researchAreas[]` is a verbatim
 * echo of its own `departments[]` gives a student zero topical signal on the
 * card, even though the write-time canonicalizer
 * (`applyResearchEntityResearchAreaCanonicalization`) already strips a
 * department-duplicate area on every fresh materialize (#1451/#1544). These
 * 25 rows carry no `fieldProvenance.researchAreas`, so nothing has
 * re-materialized them since the department name was originally written and
 * the fix never ran over them - this backfill applies the same, already-
 * correct rule directly instead of a full `materializeEntity` re-run, which
 * would drop unbacked fields.
 *
 * Scoped to entityType LAB / FACULTY_RESEARCH_AREA only: PROGRAM rows whose
 * sole area is their own department name are the deliberate dept-undergrad
 * template shape (#1281/#1460) and must not be touched.
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

const IN_SCOPE_ENTITY_TYPES = ['LAB', 'FACULTY_RESEARCH_AREA'];

interface EntityPlan {
  slug: string;
  id: string;
  entityType: string;
  before: string[];
  departments: string[];
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export function planForEntity(
  slug: string,
  id: string,
  entityType: unknown,
  researchAreas: unknown,
  departments: unknown,
): EntityPlan | null {
  if (typeof entityType !== 'string' || !IN_SCOPE_ENTITY_TYPES.includes(entityType)) return null;

  const before = asStringArray(researchAreas);
  if (before.length === 0) return null;

  const departmentList = asStringArray(departments);
  const departmentKeys = new Set(
    departmentList.map((department) => researchAreaMatchKey(department)).filter(Boolean),
  );
  if (departmentKeys.size === 0) return null;

  const isPureDepartmentEcho = before.every((area) => departmentKeys.has(researchAreaMatchKey(area)));
  if (!isPureDepartmentEcho) return null;

  return { slug, id, entityType, before, departments: departmentList };
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
    entityType?: unknown;
    researchAreas?: unknown;
    departments?: unknown;
  }>(
    {
      studentVisibilityTier: 'student_ready',
      archived: false,
      entityType: { $in: IN_SCOPE_ENTITY_TYPES },
      researchAreas: { $exists: true, $ne: [] },
    },
    { projection: { slug: 1, entityType: 1, researchAreas: 1, departments: 1 } },
  );

  const plans: EntityPlan[] = [];
  for await (const doc of cursor) {
    const id = String(doc._id);
    const plan = planForEntity(doc.slug ?? id, id, doc.entityType, doc.researchAreas, doc.departments);
    if (plan) plans.push(plan);
  }

  console.log(`\nstudent_ready LAB/FACULTY_RESEARCH_AREA rows with a pure department-echo researchAreas: ${plans.length}`);
  for (const plan of plans) {
    console.log(`\n[${plan.slug}] (${plan.entityType})`);
    console.log(`  departments: ${JSON.stringify(plan.departments)}`);
    console.log(`  researchAreas cleared: ${JSON.stringify(plan.before)}`);
  }

  if (apply && plans.length > 0) {
    for (const plan of plans) {
      await collection.updateOne(
        { _id: new mongoose.Types.ObjectId(plan.id) },
        { $set: { researchAreas: [] } },
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
