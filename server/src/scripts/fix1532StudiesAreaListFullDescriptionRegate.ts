import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { syncEntities } from '../services/meiliSyncService';
import { isStudiesResearchAreaEchoDescription } from '../utils/descriptionHygiene';
import {
  planStudentVisibilityGate,
  applyStudentVisibilityGatePlans,
  type StudentVisibilityGatePlan,
} from '../services/studentVisibilityGateService';
import { serializedDocumentId } from '../utils/idSerialization';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const apply = process.argv.includes('--apply');
const confirmed = process.argv.includes('--confirm-fix-1532');

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
    console.error('--confirm-fix-1532 is required when --apply is set.');
    process.exitCode = 1;
    return;
  }

  await initializeConnections();

  const candidates = await ResearchEntity.find({
    studentVisibilityTier: 'student_ready',
    archived: { $ne: true },
  })
    .select('_id slug fullDescription researchAreas')
    .lean();

  const affected = candidates.filter((entity: any) =>
    isStudiesResearchAreaEchoDescription(entity.fullDescription, entity.researchAreas),
  );
  const recordIds = affected.map((doc: any) => serializedDocumentId(doc._id) || String(doc._id));
  console.error(
    `Found ${recordIds.length} student_ready entities whose fullDescription is a "Studies <areas>" echo`,
  );
  if (recordIds.length === 0) return;

  const gatePlans = await planStudentVisibilityGate({
    collection: 'research',
    mode: 'dry-run',
    recordIds,
  });
  const tierChanged = gatePlans.filter((plan) => plan.tier !== plan.currentTier);
  console.error(
    `Re-gate against the fixed invariant: ${tierChanged.length}/${gatePlans.length} would change tier`,
  );
  tierChanged.forEach(logPlanChange);

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
    console.error('fix1532StudiesAreaListFullDescriptionRegate failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
