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

const PROMOTE_SLUGS = ['wyrtzen-jw678', 'bojanowska-emb229'];

const apply = process.argv.includes('--apply');
const confirmed = process.argv.includes('--confirm-fix-1718');

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
    console.error('--confirm-fix-1718 is required when --apply is set.');
    process.exitCode = 1;
    return;
  }

  await initializeConnections();

  const docs = (await ResearchEntity.find({
    archived: { $ne: true },
    slug: { $in: PROMOTE_SLUGS },
  })
    .select('_id slug studentVisibilityTier entityType')
    .lean()) as any[];

  const recordIds = docs.map((d) => serializedDocumentId(d._id) || String(d._id));
  console.error(`Resolved ${docs.length}/${PROMOTE_SLUGS.length} target slugs:`);
  for (const d of docs) console.error(`  ${d.slug} [${d.entityType}] stored=${d.studentVisibilityTier}`);
  if (docs.some((d) => d.entityType === 'LAB')) {
    console.error('Refusing: a target resolved to a LAB entity (out of lane).');
    process.exitCode = 1;
    return;
  }
  if (recordIds.length === 0) return;

  const gatePlans = await planStudentVisibilityGate({
    collection: 'research',
    mode: 'dry-run',
    recordIds,
  });
  console.error('\nAuthoritative gate recompute (dry-run):');
  gatePlans.forEach(logPlanChange);

  const notReady = gatePlans.filter((p) => p.tier !== 'student_ready');
  if (notReady.length > 0) {
    console.error(
      `\nRefusing to apply: ${notReady.length} target(s) do not recompute to student_ready.`,
    );
    process.exitCode = 1;
    return;
  }

  if (apply) {
    await applyStudentVisibilityGatePlans(gatePlans);
    console.error(`\nApplied gate updates to ${gatePlans.length} entities`);

    const fresh = await ResearchEntity.find({
      _id: { $in: recordIds.map((id) => new mongoose.Types.ObjectId(id)) },
    }).lean();
    console.error(`Re-syncing ${fresh.length} entities to Meili`);
    await syncEntities('researchEntity', fresh as any);

    const after = (await ResearchEntity.find({ slug: { $in: PROMOTE_SLUGS } })
      .select('slug studentVisibilityTier')
      .lean()) as any[];
    console.error('\nPost-apply tiers:');
    for (const d of after) console.error(`  ${d.slug}: ${d.studentVisibilityTier}`);
  } else {
    console.error('\nDRY-RUN only. Re-run with --apply --confirm-fix-1718 to persist.');
  }
}

main()
  .catch((error) => {
    console.error('fix1718StrandedFraPromote failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
