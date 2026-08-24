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
import { serializedDocumentId } from '../utils/idSerialization';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const apply = process.argv.includes('--apply');
const confirmed = process.argv.includes('--confirm-fix-1616');

// The 9 LAB/FACULTY_RESEARCH_AREA entities whose bare topic-label-list
// shortDescription (#1616) was cleared by
// repair1616TopicLabelListShortDescriptions.ts. Re-runs the live visibility
// gate for exactly these ids so their stored studentVisibilityTier matches
// the now-corrected serve-time gate rather than staying stale until a
// broader re-tier sweep runs.
const AFFECTED_IDS = [
  '6a056cac14107ca43f8a7957',
  '6a058cdfba66f3c14bd84f11',
  '6a058cf6ba66f3c14bd85132',
  '6a058d0cba66f3c14bd852cd',
  '6a058d0fba66f3c14bd852fd',
  '6a058d28ba66f3c14bd854c0',
  '6a0fa53336027326ae9c0633',
  '6a0fa56f36027326ae9c0c5d',
  '6a8b74549318b407cb6d9371',
];

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
    console.error('--confirm-fix-1616 is required when --apply is set.');
    process.exitCode = 1;
    return;
  }

  await initializeConnections();

  const affected = await ResearchEntity.find({
    _id: { $in: AFFECTED_IDS.map((id) => new mongoose.Types.ObjectId(id)) },
  })
    .select('_id slug studentVisibilityTier')
    .lean();
  const recordIds = affected.map((doc: any) => serializedDocumentId(doc._id) || String(doc._id));
  console.error(`Found ${recordIds.length}/${AFFECTED_IDS.length} affected entities`);
  if (recordIds.length === 0) return;

  const gatePlans = await planStudentVisibilityGate({
    collection: 'research',
    mode: 'dry-run',
    recordIds,
  });
  const tierChanged = gatePlans.filter((plan) => plan.tier !== plan.currentTier);
  console.error(
    'Re-gate against the bare topic-label-list shortDescription template now recognized by shortDescriptionQuality (#1616):',
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
    console.error('fix1616TopicLabelListRegate failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
