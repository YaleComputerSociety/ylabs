import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { syncEntities } from '../services/meiliSyncService';
import {
  planStudentVisibilityGate,
  applyStudentVisibilityGatePlans,
  type StudentVisibilityGatePlan,
} from '../services/studentVisibilityGateService';
import { fullDescriptionQuality } from '../utils/researchEntityDescriptionQuality';
import { serializedDocumentId } from '../utils/idSerialization';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const apply = process.argv.includes('--apply');
const confirmed = process.argv.includes('--confirm-fix-1625-still-live');

function logPlanChange(plan: StudentVisibilityGatePlan): void {
  console.log(
    `  ${plan.label}: ${plan.currentTier ?? 'unset'} -> ${plan.tier} [${plan.reasons.join(', ')}]`,
  );
}

// PR#1664/#1726 already gated the area-echo-fallback shape once, but the
// token-overlap detector missed most of the reported population - see
// isAreaEchoFallbackFullDescription in researchEntityDescriptionQuality.ts
// for the closer-sentence and name-noise fixes that this script's dry-run
// count depends on. This is a fresh sweep with the corrected detector, not a
// re-run of the original script.
async function main(): Promise<void> {
  const uri = process.env.MONGODBURL || '';
  const pathname = new URL(uri).pathname;
  if (pathname !== '/Development') {
    console.error(`Refusing to run: MONGODBURL pathname is ${pathname}, not /Development`);
    process.exitCode = 1;
    return;
  }
  if (apply && !confirmed) {
    console.error('--confirm-fix-1625-still-live is required when --apply is set.');
    process.exitCode = 1;
    return;
  }

  await initializeConnections();

  const candidates = (await ResearchEntity.find({
    archived: { $ne: true },
    studentVisibilityTier: 'student_ready',
  })
    .select('_id slug fullDescription researchAreas')
    .lean()) as any[];

  const affected = candidates.filter((doc) =>
    fullDescriptionQuality(doc.fullDescription, doc.researchAreas).flags.includes(
      'area-echo-fallback',
    ),
  );
  const recordIds = affected.map((doc) => serializedDocumentId(doc._id) || String(doc._id));
  console.error(
    `Found ${recordIds.length}/${candidates.length} student_ready entities matching the fluent area-echo fullDescription shape (#1625 still-live sweep)`,
  );
  if (recordIds.length === 0) return;

  const gatePlans = await planStudentVisibilityGate({
    collection: 'research',
    mode: 'dry-run',
    recordIds,
  });
  const tierChanged = gatePlans.filter((plan) => plan.tier !== plan.currentTier);
  console.error(
    'Re-gate against the hardened area-echo fallback detector (#1625 closer-sentence/name-noise fix):',
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
    console.error('fix1625AreaEchoFallbackStillLiveRegate failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
