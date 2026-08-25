import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import {
  normalizeHygieneWhitespace,
  sanitizeResearchEntityDescription,
  stripLeadingAdministrativeTitleListDump,
} from '../utils/descriptionHygiene';
import { runStudentVisibilityGate } from '../services/studentVisibilityGateService';
import { syncEntities } from '../services/meiliSyncService';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const apply = process.argv.includes('--apply');
const confirmed = process.argv.includes('--confirm-fix-1815');
const maxApplyArg = process.argv.find((arg) => arg.startsWith('--max-apply='));
const maxApply = maxApplyArg ? Number(maxApplyArg.slice('--max-apply='.length)) : 50;

interface RepairedRecord {
  id: string;
  slug: string;
  tier: string;
  outcome: 'split' | 'blanked';
  oldFullDescription: string;
  newFullDescription: string;
}

/**
 * #1815 backfill: a stored fullDescription that opens with a bare
 * administrative appointment-title run concatenated - with no delimiting
 * punctuation - directly onto the next block (a bio narrative, or nothing at
 * all). The serve-time sanitizer now repairs this via
 * stripLeadingAdministrativeTitleListDump, but the stored field stays
 * uncorrected until something rewrites it.
 *
 * Candidacy is decided solely by the targeted detector: a record is in scope
 * only when stripLeadingAdministrativeTitleListDump changes the normalized
 * fullDescription (either splitting off a kept narrative or failing the pure
 * title dump closed to ''). The written value is the full
 * sanitizeResearchEntityDescription output so the stored field matches exactly
 * what serve-time produces (no stored/served drift), while the narrow
 * candidacy filter keeps the blast radius to the #1815 defect rather than
 * every record any other hygiene guard would also touch.
 */
function repairAdminTitleListLead(full: unknown): {
  outcome: 'unchanged' | 'split' | 'blanked';
  fullDescription: string;
} {
  const original = typeof full === 'string' ? full : '';
  const normalized = normalizeHygieneWhitespace(original);
  if (!normalized) return { outcome: 'unchanged', fullDescription: original };

  const stripped = stripLeadingAdministrativeTitleListDump(original);
  // Pass-through returns the normalized input unchanged; only a real strip
  // (a kept narrative, or '' for a pure dump) differs from it.
  if (stripped === normalized) return { outcome: 'unchanged', fullDescription: original };

  const served = sanitizeResearchEntityDescription(original);
  return { outcome: served ? 'split' : 'blanked', fullDescription: served };
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
    console.error('--confirm-fix-1815 is required when --apply is set.');
    process.exitCode = 1;
    return;
  }
  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'fix1815AdminTitleListFullDescription',
    mongoUrl: uri,
  });
  console.error(`Target: ${guard.environment} / ${guard.dbLabel}`);

  await initializeConnections();

  // Scope: any non-archived entity with a non-empty string fullDescription.
  // The narrow candidacy check (repairAdminTitleListLead) does the real
  // filtering; the query only avoids scanning archived rows and empty fields.
  const candidates = await ResearchEntity.find({
    archived: { $ne: true },
    fullDescription: { $type: 'string', $ne: '' },
  })
    .select('_id slug studentVisibilityTier fullDescription')
    .lean();

  console.error(`Scanned ${candidates.length} candidate entities with a string fullDescription`);

  const repaired: RepairedRecord[] = [];
  for (const entity of candidates) {
    const result = repairAdminTitleListLead(entity.fullDescription);
    if (result.outcome === 'unchanged') continue;
    repaired.push({
      id: String(entity._id),
      slug: entity.slug,
      tier: String(entity.studentVisibilityTier ?? ''),
      outcome: result.outcome,
      oldFullDescription: typeof entity.fullDescription === 'string' ? entity.fullDescription : '',
      newFullDescription: result.fullDescription,
    });
  }

  const splitCount = repaired.filter((r) => r.outcome === 'split').length;
  const blankedCount = repaired.filter((r) => r.outcome === 'blanked').length;
  console.error(
    `Leading admin-title-list glue detected on ${repaired.length} entities (${splitCount} split to keep the narrative, ${blankedCount} pure title dumps failed closed)`,
  );

  for (const record of repaired) {
    console.log(`${apply ? 'APPLY' : 'DRY-RUN'} [${record.outcome}] ${record.slug} (${record.tier})`);
    console.log('  OLD FULL:', JSON.stringify(record.oldFullDescription).slice(0, 240));
    console.log('  NEW FULL:', JSON.stringify(record.newFullDescription).slice(0, 240));
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
      { $set: { fullDescription: record.newFullDescription } },
    );
  }
  console.error(`Updated fullDescription on ${repaired.length} entities`);

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
    console.error('fix1815AdminTitleListFullDescription failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
