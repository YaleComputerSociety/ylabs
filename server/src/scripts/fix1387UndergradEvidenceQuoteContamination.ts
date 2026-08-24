import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { materializeAccessForResearchGroup } from '../scrapers/accessMaterializer';
import { isPlausibleUndergradEvidenceQuote } from '../scrapers/undergradEvidenceQuoteValidation';
import { syncEntities } from '../services/meiliSyncService';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const apply = process.argv.includes('--apply');
const confirmed = process.argv.includes('--confirm-fix-1387');
const maxApplyArg = process.argv.find((arg) => arg.startsWith('--max-apply='));
const maxApply = maxApplyArg ? Number(maxApplyArg.slice('--max-apply='.length)) : 500;

async function main(): Promise<void> {
  const uri = process.env.MONGODBURL || '';
  const pathname = new URL(uri).pathname;
  if (pathname !== '/Development') {
    console.error(`Refusing to run: MONGODBURL pathname is ${pathname}, not /Development`);
    process.exitCode = 1;
    return;
  }
  if (apply && !confirmed) {
    console.error('--confirm-fix-1387 is required when --apply is set.');
    process.exitCode = 1;
    return;
  }

  await initializeConnections();

  const candidates = await ResearchEntity.find({
    undergradEvidenceQuote: { $type: 'string', $ne: '' },
  })
    .select('_id slug undergradEvidenceQuote manuallyLockedFields')
    .lean();

  const contaminated = candidates.filter(
    (entity) =>
      !(entity.manuallyLockedFields || []).includes('undergradEvidenceQuote') &&
      !isPlausibleUndergradEvidenceQuote(entity.undergradEvidenceQuote as string),
  );

  console.error(`Scanned ${candidates.length} entities with a populated undergradEvidenceQuote`);
  console.error(`Contaminated (fails write-time validator): ${contaminated.length}`);

  for (const entity of contaminated) {
    console.log(`${apply ? 'APPLY' : 'DRY-RUN'} ${entity.slug}`);
    console.log('  quote:', JSON.stringify(entity.undergradEvidenceQuote).slice(0, 160));
  }

  if (!apply) {
    await mongoose.disconnect();
    return;
  }
  if (contaminated.length > maxApply) {
    console.error(
      `Apply would clear ${contaminated.length} entities, above --max-apply=${maxApply}. Aborting without writes.`,
    );
    process.exitCode = 1;
    await mongoose.disconnect();
    return;
  }

  const fixedIds: string[] = [];
  for (const entity of contaminated) {
    await ResearchEntity.updateOne(
      { _id: entity._id },
      {
        $unset: {
          undergradEvidenceQuote: '',
          'confidenceByField.undergradEvidenceQuote': '',
          'fieldProvenance.undergradEvidenceQuote': '',
        },
      },
    );
    await materializeAccessForResearchGroup({
      researchEntityId: String(entity._id),
      entityKey: entity.slug,
    });
    fixedIds.push(String(entity._id));
  }

  console.error(`Cleared undergradEvidenceQuote on: ${fixedIds.length} entities`);

  if (fixedIds.length === 0) {
    await mongoose.disconnect();
    return;
  }

  const docs = await ResearchEntity.find({
    _id: { $in: fixedIds.map((id) => new mongoose.Types.ObjectId(id)) },
  }).lean();
  console.error(`Re-syncing ${docs.length} entities to Meili`);
  await syncEntities('researchEntity', docs as any);
}

main()
  .catch((error) => {
    console.error('fix1387UndergradEvidenceQuoteContamination failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
