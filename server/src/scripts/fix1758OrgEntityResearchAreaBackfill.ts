import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { getResearchAreaCanonicalizer } from '../scrapers/researchAreaCanonicalization';
import { syncEntities } from '../services/meiliSyncService';
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
const confirmed = process.argv.includes('--confirm-fix-1758');

const ORG_ENTITY_TYPES_WITHOUT_FACET_SIGNAL = ['CENTER', 'INSTITUTE', 'PROGRAM'];

function logRow(row: ResearchAreaBackfillPlanRow): void {
  if (row.changed) {
    console.log(`  [${row.slug || row.id}] [] -> [${row.after.join(', ')}]`);
  } else {
    console.log(`  [${row.slug || row.id}] no canonical research area derivable, leaving as-is`);
  }
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
    console.error('--confirm-fix-1758 is required when --apply is set.');
    process.exitCode = 1;
    return;
  }

  await initializeConnections();

  const candidates = (await ResearchEntity.find({
    archived: { $ne: true },
    studentVisibilityTier: 'student_ready',
    entityType: { $in: ORG_ENTITY_TYPES_WITHOUT_FACET_SIGNAL },
    $or: [{ researchAreas: { $exists: false } }, { researchAreas: { $size: 0 } }],
  })
    .select('_id slug name entityType departments researchAreas shortDescription fullDescription')
    .lean()) as any[];

  console.error(
    `Found ${candidates.length} student_ready CENTER/INSTITUTE/PROGRAM entities with empty researchAreas[] (issue #1758)`,
  );
  if (candidates.length === 0) return;

  const canonicalizer = await getResearchAreaCanonicalizer();
  const rows = candidates.map((doc) =>
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
  const changedRows = rows.filter((row) => row.changed);
  console.error(
    `Research-area backfill (dept + description derivation, no gate change): ${changedRows.length}/${rows.length} carry a genuine canonical match`,
  );
  console.error(
    'CENTER/INSTITUTE/PROGRAM do not require a research-area facet signal to remain student_ready ' +
      '(the entity is lead-exempt and organizationally contactable via its own page, consistent with ' +
      'isOrganizationalResearchEntity); rows without a genuine canonical match are left unchanged rather ' +
      'than synthesizing a vacuous chip.',
  );
  rows.forEach(logRow);

  if (apply && changedRows.length > 0) {
    await ResearchEntity.bulkWrite(
      changedRows.map((row) => ({
        updateOne: { filter: { _id: row.id }, update: { $set: { researchAreas: row.after } } },
      })),
    );
    console.error(`Persisted research-area backfill for ${changedRows.length} entities`);

    const ids = changedRows.map((row) => new mongoose.Types.ObjectId(row.id));
    const fresh = await ResearchEntity.find({ _id: { $in: ids } }).lean();
    console.error(`Re-syncing ${fresh.length} entities to Meili`);
    await syncEntities('researchEntity', fresh as any);
  }
}

main()
  .catch((error) => {
    console.error('fix1758OrgEntityResearchAreaBackfill failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
