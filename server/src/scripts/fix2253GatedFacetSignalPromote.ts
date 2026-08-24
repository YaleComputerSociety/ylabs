import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { getResearchAreaCanonicalizer } from '../scrapers/researchAreaCanonicalization';
import { syncEntities } from '../services/meiliSyncService';
import {
  isBlockingVisibilityReason,
  planStudentVisibilityGate,
  applyStudentVisibilityGatePlans,
  researchEntityGateProjection,
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
const confirmed = process.argv.includes('--confirm-fix-2253');

const GATED_TIERS = ['operator_review', 'limited_but_safe', 'suppressed'];

function logAreaChange(row: ResearchAreaBackfillPlanRow): void {
  console.error(`  ${row.slug || row.id}: [] -> [${row.after.join(', ')}]`);
}

function logPlanChange(plan: StudentVisibilityGatePlan): void {
  console.error(
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
    console.error('--confirm-fix-2253 is required when --apply is set.');
    process.exitCode = 1;
    return;
  }

  await initializeConnections();

  const gated = (await ResearchEntity.find({
    archived: { $ne: true },
    studentVisibilityTier: { $in: GATED_TIERS },
    entityType: { $in: ['LAB', 'FACULTY_RESEARCH_AREA'] },
    $or: [{ researchAreas: { $exists: false } }, { researchAreas: { $size: 0 } }],
  })
    .select(researchEntityGateProjection)
    .lean()) as any[];

  const candidates = gated.filter((entity) => {
    const reasons: string[] = Array.isArray(entity.studentVisibilityReasons)
      ? entity.studentVisibilityReasons
      : [];
    const blockers = reasons.filter(isBlockingVisibilityReason);
    return blockers.length === 1 && blockers[0] === 'missing_facet_signal';
  });

  console.error(
    `Gated LAB/FACULTY_RESEARCH_AREA blocked solely by missing_facet_signal: ${candidates.length}`,
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
  const changedAreaRows = areaRows.filter((row) => row.changed && row.after.length > 0);
  console.error(
    `\nResearch-area derivation (grounded in each entity's own name/short/full): ${changedAreaRows.length}/${areaRows.length} would gain areas`,
  );
  changedAreaRows.forEach(logAreaChange);

  const underivable = areaRows.filter((row) => !(row.changed && row.after.length > 0));
  if (underivable.length > 0) {
    console.error(`\nNo grounded areas derivable (held): ${underivable.length}`);
    underivable.forEach((row) => console.error(`  ${row.slug || row.id}`));
  }

  if (apply && changedAreaRows.length > 0) {
    await ResearchEntity.bulkWrite(
      changedAreaRows.map((row) => ({
        updateOne: { filter: { _id: row.id }, update: { $set: { researchAreas: row.after } } },
      })),
    );
    console.error(`\nPersisted research-area backfill for ${changedAreaRows.length} entities`);
  }

  const changedIds = new Set(changedAreaRows.map((row) => row.id));
  const gateIds = recordIds.filter((id) => changedIds.has(id));
  const gatePlans = await planStudentVisibilityGate({
    collection: 'research',
    mode: 'dry-run',
    recordIds: gateIds,
  });
  const promoted = gatePlans.filter(
    (plan) => plan.tier === 'student_ready' || plan.tier === 'limited_but_safe',
  );
  console.error(`\nGate recompute (dry-run): ${promoted.length}/${gatePlans.length} reach a public tier`);
  gatePlans.forEach(logPlanChange);

  if (apply) {
    await applyStudentVisibilityGatePlans(gatePlans);
    console.error(`\nApplied gate updates to ${gatePlans.length} entities`);

    const fresh = await ResearchEntity.find({
      _id: { $in: gateIds.map((id) => new mongoose.Types.ObjectId(id)) },
    }).lean();
    console.error(`Re-syncing ${fresh.length} entities to Meili`);
    await syncEntities('researchEntity', fresh as any);

    const verify = (await ResearchEntity.find({
      _id: { $in: gateIds.map((id) => new mongoose.Types.ObjectId(id)) },
    })
      .select('slug studentVisibilityTier researchAreas')
      .lean()) as any[];
    const stillGated = verify.filter((doc) => GATED_TIERS.includes(doc.studentVisibilityTier));
    console.error(
      `\nPost-apply verify: ${verify.length - stillGated.length}/${verify.length} now public.`,
    );
    stillGated.forEach((doc) =>
      console.error(`  STILL-GATED ${doc.slug}: ${doc.studentVisibilityTier}`),
    );
  }
}

main()
  .catch((error) => {
    console.error('fix2253GatedFacetSignalPromote failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
