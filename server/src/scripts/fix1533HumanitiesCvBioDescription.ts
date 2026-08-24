import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { repairPersonBiographyLeakedDescription } from '../utils/researchEntityBiographyDescriptionRepair';
import { runStudentVisibilityGate } from '../services/studentVisibilityGateService';
import { syncEntities } from '../services/meiliSyncService';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const apply = process.argv.includes('--apply');
const confirmed = process.argv.includes('--confirm-fix-1533');
const maxApplyArg = process.argv.find((arg) => arg.startsWith('--max-apply='));
const maxApply = maxApplyArg ? Number(maxApplyArg.slice('--max-apply='.length)) : 50;

interface RepairedRecord {
  id: string;
  slug: string;
  outcome: 'resynthesized' | 'blanked';
  oldShortDescription: string;
  newShortDescription: string;
  oldFullDescription: string;
  newFullDescription: string;
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
    console.error('--confirm-fix-1533 is required when --apply is set.');
    process.exitCode = 1;
    return;
  }
  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'fix1533HumanitiesCvBioDescription',
    mongoUrl: uri,
  });
  console.error(`Target: ${guard.environment} / ${guard.dbLabel}`);

  await initializeConnections();

  // Scope: every live student_ready entity with a fullDescription, not just
  // #1456's kind:lab cohort - the humanities residual (#1533) is on
  // kind:individual / entityType:FACULTY_RESEARCH_AREA rows (a raw faculty-bio
  // degree-list lead or an award/teaching-history CV with no research-topic
  // sentence at all), which #1456's lab-only query never scanned.
  // repairPersonBiographyLeakedDescription is a no-op ('unchanged') on any
  // description that doesn't match a biography/CV/degree-list signature, so
  // widening the scope here is safe.
  const candidates = await ResearchEntity.find({
    studentVisibilityTier: 'student_ready',
    archived: { $ne: true },
    fullDescription: { $type: 'string', $ne: '' },
  })
    .select('_id slug shortDescription fullDescription researchAreas')
    .lean();

  console.error(`Scanned ${candidates.length} student_ready entities with a fullDescription`);

  const repaired: RepairedRecord[] = [];
  for (const entity of candidates) {
    const result = repairPersonBiographyLeakedDescription({
      fullDescription: entity.fullDescription,
      shortDescription: entity.shortDescription,
      researchAreas: entity.researchAreas,
    });
    if (result.outcome === 'unchanged') continue;
    repaired.push({
      id: String(entity._id),
      slug: entity.slug,
      outcome: result.outcome,
      oldShortDescription: typeof entity.shortDescription === 'string' ? entity.shortDescription : '',
      newShortDescription: result.shortDescription,
      oldFullDescription: typeof entity.fullDescription === 'string' ? entity.fullDescription : '',
      newFullDescription: result.fullDescription,
    });
  }

  const resynthesizedCount = repaired.filter((r) => r.outcome === 'resynthesized').length;
  const blankedCount = repaired.filter((r) => r.outcome === 'blanked').length;
  console.error(
    `Humanities CV/bio leak detected on ${repaired.length} entities (${resynthesizedCount} re-synthesized from real content, ${blankedCount} routed to no-description fallback)`,
  );

  for (const record of repaired) {
    console.log(`${apply ? 'APPLY' : 'DRY-RUN'} [${record.outcome}] ${record.slug} (${record.id})`);
    console.log('  OLD SHORT:', JSON.stringify(record.oldShortDescription).slice(0, 200));
    console.log('  NEW SHORT:', JSON.stringify(record.newShortDescription).slice(0, 200));
    console.log('  OLD FULL: ', JSON.stringify(record.oldFullDescription).slice(0, 200));
    console.log('  NEW FULL: ', JSON.stringify(record.newFullDescription).slice(0, 200));
  }

  if (!apply) {
    await mongoose.disconnect();
    return;
  }
  if (repaired.length > maxApply) {
    console.error(
      `Apply would touch ${repaired.length} entities, above --max-apply=${maxApply}. Aborting without writes.`,
    );
    process.exitCode = 1;
    await mongoose.disconnect();
    return;
  }

  for (const record of repaired) {
    await ResearchEntity.updateOne(
      { _id: record.id },
      {
        $set: {
          shortDescription: record.newShortDescription,
          fullDescription: record.newFullDescription,
        },
      },
    );
  }
  console.error(`Updated description fields on ${repaired.length} entities`);

  const touchedIds = repaired.map((record) => record.id);
  if (touchedIds.length > 0) {
    const gateReport = await runStudentVisibilityGate({
      collection: 'research',
      mode: 'apply',
      recordIds: touchedIds,
    });
    console.error(
      `Re-gated ${touchedIds.length} touched entities: ${JSON.stringify(gateReport.counts)}`,
    );

    const docs = await ResearchEntity.find({
      _id: { $in: touchedIds.map((id) => new mongoose.Types.ObjectId(id)) },
    }).lean();
    console.error(`Re-syncing ${docs.length} entities to Meili`);
    await syncEntities('researchEntity', docs as any);
  }
}

main()
  .catch((error) => {
    console.error('fix1533HumanitiesCvBioDescription failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
