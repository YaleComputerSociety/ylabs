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
const confirmed = process.argv.includes('--confirm-fix-1598');

const AFFECTED_SLUGS = [
  'nih-pi-john-krystal',
  'nih-pi-ruth-asch',
  'nih-pi-sarah-lichenstein',
  'nih-pi-lauren-pischel',
  'faculty-research-area-janghoo-lim',
  'faculty-research-area-alicia-che',
  'faculty-research-area-alfred-kaye',
  'faculty-research-area-jane-taylor',
  'nih-pi-sheela-shenoi',
  'nih-pi-yuan-lu',
  'nih-pi-julia-rozanova',
  'faculty-research-area-anirvan-nandy',
  'nih-pi-nicola-santoro',
  'gerrard-lab-jlg87',
  'coppola-lab-gc223',
  'gendler-tgendler',
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
    console.error('--confirm-fix-1598 is required when --apply is set.');
    process.exitCode = 1;
    return;
  }

  await initializeConnections();

  const affected = await ResearchEntity.find({ slug: { $in: AFFECTED_SLUGS } })
    .select('_id slug studentVisibilityTier')
    .lean();
  const recordIds = affected.map((doc: any) => serializedDocumentId(doc._id) || String(doc._id));
  console.error(`Found ${recordIds.length}/${AFFECTED_SLUGS.length} affected entities`);
  if (recordIds.length === 0) return;

  const gatePlans = await planStudentVisibilityGate({
    collection: 'research',
    mode: 'dry-run',
    recordIds,
  });
  const tierChanged = gatePlans.filter((plan) => plan.tier !== plan.currentTier);
  console.error('Re-gate against the "is connected to" area-echo template now recognized by fullDescriptionQuality (#1598):');
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
    console.error('fix1598ResearchAreaEchoRegate failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
