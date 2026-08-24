import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { getResearchAreaCanonicalizer } from '../scrapers/researchAreaCanonicalization';
import { syncEntities } from '../services/meiliSyncService';
import {
  planStudentVisibilityGate,
  applyStudentVisibilityGatePlans,
  type StudentVisibilityGatePlan,
} from '../services/studentVisibilityGateService';
import {
  normalizeMaxAreas,
  planResearchAreaBackfillRow,
  type ResearchAreaBackfillPlanRow,
} from './backfillResearchAreasCore';
import { serializedDocumentId } from '../utils/idSerialization';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const apply = process.argv.includes('--apply');
const confirmed = process.argv.includes('--confirm-fix-1717');

function logAreaChange(row: ResearchAreaBackfillPlanRow): void {
  console.log(`  ${row.slug || row.id}: [] -> [${row.after.join(', ')}]`);
}

function logPlanChange(plan: StudentVisibilityGatePlan): void {
  console.log(
    `  ${plan.label}: ${plan.currentTier ?? 'unset'} -> ${plan.tier} [${plan.reasons.join(', ')}]`,
  );
}

async function main(): Promise<void> {
  const uri = process.env.MONGODBURL || '';
  const pathname = new URL(uri).pathname;
  if (pathname !== '/Development') {
    console.error(`Refusing to run: MONGODBURL pathname is ${pathname}, not /Development`);
    process.exitCode = 1;
    return;
  }
  if (apply && !confirmed) {
    console.error('--confirm-fix-1717 is required when --apply is set.');
    process.exitCode = 1;
    return;
  }

  await initializeConnections();

  const candidates = (await ResearchEntity.find({
    archived: { $ne: true },
    studentVisibilityTier: 'student_ready',
    entityType: { $in: ['LAB', 'FACULTY_RESEARCH_AREA'] },
    $or: [{ researchAreas: { $exists: false } }, { researchAreas: { $size: 0 } }],
  })
    .select('_id slug name departments researchAreas shortDescription fullDescription')
    .lean()) as any[];

  console.error(
    `Found ${candidates.length} student_ready LAB/FACULTY_RESEARCH_AREA entities with empty researchAreas[] (issue #1717)`,
  );
  if (candidates.length === 0) return;

  const recordIds = candidates.map((doc) => serializedDocumentId(doc._id) || String(doc._id));

  const canonicalizer = await getResearchAreaCanonicalizer();
  const areaRows = candidates.map((doc) =>
    planResearchAreaBackfillRow(
      canonicalizer,
      {
        id: serializedDocumentId(doc._id) || String(doc._id),
        slug: doc.slug,
        name: doc.name,
        departments: doc.departments,
        existingResearchAreas: doc.researchAreas,
        shortDescription: doc.shortDescription,
        fullDescription: doc.fullDescription,
      },
      { onlyEmpty: true, maxAreas: normalizeMaxAreas(undefined) },
    ),
  );
  const changedAreaRows = areaRows.filter((row) => row.changed);
  console.error(
    `Research-area backfill (dept + description derivation): ${changedAreaRows.length}/${areaRows.length} would gain areas`,
  );
  changedAreaRows.forEach(logAreaChange);

  if (apply && changedAreaRows.length > 0) {
    await ResearchEntity.bulkWrite(
      changedAreaRows.map((row) => ({
        updateOne: { filter: { _id: row.id }, update: { $set: { researchAreas: row.after } } },
      })),
    );
    console.error(`Persisted research-area backfill for ${changedAreaRows.length} entities`);
  }

  const gatePlans = await planStudentVisibilityGate({
    collection: 'research',
    mode: 'dry-run',
    recordIds,
  });
  const tierChanged = gatePlans.filter((plan) => plan.tier !== plan.currentTier);
  console.error(
    `Re-gate against the requirement that LAB/FACULTY_RESEARCH_AREA carry at least one research area (#1717):`,
  );
  console.error(`${tierChanged.length}/${gatePlans.length} would change tier`);
  gatePlans.forEach(logPlanChange);

  if (apply) {
    await applyStudentVisibilityGatePlans(gatePlans);
    console.error(`Applied gate updates to ${gatePlans.length} entities`);

    const fresh = await ResearchEntity.find({
      _id: { $in: recordIds.map((id) => new mongoose.Types.ObjectId(id)) },
    }).lean();
    console.error(`Re-syncing ${fresh.length} entities to Meili`);
    await syncEntities('researchEntity', fresh as any);
  }
}

main()
  .catch((error) => {
    console.error('fix1717EmptyResearchAreaFacetGate failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
