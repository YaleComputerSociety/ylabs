import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { deriveProgramCardShortDescription } from '../utils/researchEntityDescriptionQuality';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

async function main(): Promise<void> {
  await initializeConnections();
  try {
    const entities = await ResearchEntity.find({
      entityType: { $in: ['FELLOWSHIP_PROGRAM', 'RA_PROGRAM', 'PROGRAM'] },
      studentVisibilityTier: 'student_ready',
      archived: { $ne: true },
    })
      .select('_id name entityType shortDescription fullDescription')
      .lean()
      .sort({ _id: 1 });

    console.log(`cohort size: ${entities.length}`);

    let changed = 0;
    let unexpectedlyChanged = 0;
    for (const e of entities) {
      const before = textValue(e.shortDescription);
      const after = deriveProgramCardShortDescription(e.fullDescription);
      if (before === after) continue;
      changed += 1;
      console.log('====', String(e._id), e.name, '|', e.entityType);
      console.log('BEFORE:', before || '(blank)');
      console.log('AFTER: ', after || '(blank)');
    }
    console.log(`\ntotal changed if re-derived+applied: ${changed}`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
