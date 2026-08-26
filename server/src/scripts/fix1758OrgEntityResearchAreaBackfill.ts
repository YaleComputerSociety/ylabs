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

// The 6 CENTER/INSTITUTE/PROGRAM rows named in issue #1758 as the remainder of
// the corpus-wide empty-researchAreas scan not covered by #1717 (LAB/FRA) or
// #1700 (FELLOWSHIP_PROGRAM/RA_PROGRAM). Deliberately record-scoped rather than
// a fresh entityType query: a broad CENTER/INSTITUTE/PROGRAM query also matches
// ~20 shared core research facilities (electron microscopy, flow cytometry,
// sequencing cores, ...) that are a distinct, already-settled correct-hold class
// with no disciplinary research-area identity of their own; running the same
// derivation over them produces vacuous chips (e.g. an EM core matching
// "Public Health" from unrelated boilerplate).
const IN_SCOPE_RECORD_IDS = [
  '6a057e2213fc60d57ec2aee7', // Olin Neuropsychiatry Research Center (CENTER)
  '6a058d97ba66f3c14bd85c76', // Yale CPPEE (CENTER)
  '6a1385f0f601c74f4f7f98e4', // Yale Nanobiology Institute (INSTITUTE)
  '6a057e0e13fc60d57ec2aa5d', // Yale Translational Brain Imaging Program (PROGRAM)
  '6a0d17853fa399fefb6e5683', // Yale Program in Addiction Medicine (PROGRAM)
  '6a8ba10afabb544dac7e61f8', // CS Research Internship Program (PROGRAM)
];

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
    _id: { $in: IN_SCOPE_RECORD_IDS.map((id) => new mongoose.Types.ObjectId(id)) },
    archived: { $ne: true },
    studentVisibilityTier: 'student_ready',
    entityType: { $in: ['CENTER', 'INSTITUTE'] },
    $or: [{ researchAreas: { $exists: false } }, { researchAreas: { $size: 0 } }],
  })
    .select('_id slug name entityType departments researchAreas shortDescription fullDescription')
    .lean()) as any[];

  console.error(
    `Found ${candidates.length}/${IN_SCOPE_RECORD_IDS.length} in-scope CENTER/INSTITUTE/PROGRAM entities still student_ready with empty researchAreas[] (issue #1758)`,
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
