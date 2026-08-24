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
const confirmed = process.argv.includes('--confirm-fix-1456');
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
    console.error('--confirm-fix-1456 is required when --apply is set.');
    process.exitCode = 1;
    return;
  }
  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'fix1456LabPiBiographyDescription',
    mongoUrl: uri,
  });
  console.error(`Target: ${guard.environment} / ${guard.dbLabel}`);

  await initializeConnections();

  // Scope: student_ready lab-kind entities (#1456's 25 kind:lab rows plus the
  // 1 individual/LAB row) with a non-empty fullDescription. The 39
  // FACULTY_RESEARCH_AREA rows in the same issue belong to #1412 and are
  // excluded by this kind/entityType filter.
  const candidates = await ResearchEntity.find({
    studentVisibilityTier: 'student_ready',
    archived: { $ne: true },
    $or: [{ kind: 'lab' }, { entityType: 'LAB' }],
    fullDescription: { $type: 'string', $ne: '' },
  })
    .select('_id slug shortDescription fullDescription researchAreas')
    .lean();

  console.error(`Scanned ${candidates.length} student_ready lab-kind entities`);

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
    `PI-bio/CV leak detected on ${repaired.length} entities (${resynthesizedCount} re-synthesized from real content, ${blankedCount} routed to no-description fallback)`,
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
    console.error('fix1456LabPiBiographyDescription failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
