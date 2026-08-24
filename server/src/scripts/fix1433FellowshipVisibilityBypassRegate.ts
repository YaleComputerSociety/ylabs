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
import { runCardSynthesisBackfill } from './backfillResearchDescriptions';
import { serializedDocumentId } from '../utils/idSerialization';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const BYPASS_REASON = 'projected_from_student_ready_fellowship';
const apply = process.argv.includes('--apply');
const confirmed = process.argv.includes('--confirm-fix-1433');

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
    console.error('--confirm-fix-1433 is required when --apply is set.');
    process.exitCode = 1;
    return;
  }

  await initializeConnections();

  const bypassed = await ResearchEntity.find({ studentVisibilityReasons: BYPASS_REASON })
    .select('_id slug studentVisibilityTier')
    .lean();
  const recordIds = bypassed.map((doc: any) => serializedDocumentId(doc._id) || String(doc._id));
  console.error(`Found ${recordIds.length} entities with reason "${BYPASS_REASON}"`);
  if (recordIds.length === 0) return;

  const gatePlans = await planStudentVisibilityGate({
    collection: 'research',
    mode: 'dry-run',
    recordIds,
  });
  const tierChanged = gatePlans.filter((plan) => plan.tier !== plan.currentTier);
  console.error(
    `Round 1 (re-gate against the real invariant): ${tierChanged.length}/${gatePlans.length} would change tier`,
  );
  tierChanged.forEach(logPlanChange);

  if (apply) {
    await applyStudentVisibilityGatePlans(gatePlans);
    console.error(`Applied round-1 gate updates to ${gatePlans.length} entities`);
  }

  const cardCandidateIds = gatePlans
    .filter((plan) => plan.reasons.includes('missing_card_description'))
    .map((plan) => plan.recordId);
  console.error(`Round 2 (card-synthesis candidates, missing_card_description): ${cardCandidateIds.length}`);

  let repromoted: StudentVisibilityGatePlan[] = [];
  if (cardCandidateIds.length > 0) {
    const cardResult = await runCardSynthesisBackfill({
      dryRun: !apply,
      recordIds: cardCandidateIds,
    });
    console.error(
      `Round 2 (card-synthesis): ${cardResult.updated}/${cardResult.scanned} cards written`,
      cardResult.summary,
    );

    const repromotePlans = await planStudentVisibilityGate({
      collection: 'research',
      mode: 'dry-run',
      recordIds: cardCandidateIds,
    });
    repromoted = repromotePlans.filter((plan) => plan.tier !== plan.currentTier);
    console.error(
      `Round 3 (re-gate after card synthesis): ${repromoted.length}/${repromotePlans.length} would change tier`,
    );
    repromoted.forEach(logPlanChange);

    if (apply) {
      await applyStudentVisibilityGatePlans(repromotePlans);
      console.error(`Applied round-3 gate updates to ${repromotePlans.length} entities`);
    }
  }

  if (apply) {
    const fresh = await ResearchEntity.find({
      _id: { $in: recordIds.map((id) => new mongoose.Types.ObjectId(id)) },
    }).lean();
    console.error(`Re-syncing ${fresh.length} entities to Meili`);
    await syncEntities('researchEntity', fresh as any);
  }
}

main()
  .catch((error) => {
    console.error('fix1433FellowshipVisibilityBypassRegate failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
