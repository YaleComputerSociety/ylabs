import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { buildWhy1634Plans } from './fix1634WhyBulletFabricationPurgeCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  const uri = process.env.MONGODBURL || '';
  const pathname = new URL(uri).pathname;
  if (pathname !== '/Development') {
    console.error(`Refusing to run: MONGODBURL pathname is ${pathname}, not /Development`);
    process.exitCode = 1;
    return;
  }

  await initializeConnections();
  console.log(`mode: ${apply ? 'APPLY' : 'DRY-RUN'} | db: ${pathname}`);

  const candidates = await ResearchEntity.find({
    studentVisibilityTier: 'student_ready',
    archived: { $ne: true },
    'studentDecisionExplanation.why': { $exists: true, $type: 'array', $ne: [] },
  })
    .select('_id slug studentDecisionExplanation researchAreas fullDescription')
    .lean();

  const plans = buildWhy1634Plans(candidates as any);
  console.log(
    `\n${plans.length}/${candidates.length} live student_ready entities carry a fabricated why bullet:`,
  );
  for (const plan of plans) {
    console.log(`  [${plan.slug}] ${plan.id}`);
    for (const removed of plan.removedBullets) {
      console.log(`    - remove (${removed.issues.join(',')}): ${removed.bullet}`);
    }
    if (plan.unsetWholeField) {
      console.log('    - all why bullets fabricated: unset entire studentDecisionExplanation field');
    } else {
      console.log(`    - keep: ${JSON.stringify(plan.keptWhy)}`);
    }
  }

  if (apply && plans.length > 0) {
    // studentDecisionExplanation is no longer a schema path (retired in #440), so writes
    // must go through the raw driver collection - Mongoose's strict-mode update casting
    // silently drops unknown paths from $set/$unset and reports a false modifiedCount.
    for (const plan of plans) {
      const objectId = new mongoose.Types.ObjectId(plan.id);
      if (plan.unsetWholeField) {
        await ResearchEntity.collection.updateOne(
          { _id: objectId },
          { $unset: { studentDecisionExplanation: '' } },
        );
      } else {
        await ResearchEntity.collection.updateOne(
          { _id: objectId },
          { $set: { 'studentDecisionExplanation.why': plan.keptWhy } },
        );
      }
    }
    console.log(`\napplied purge to ${plans.length} entities`);
    console.log(
      'studentDecisionExplanation is not projected into any public DTO or Meili document (retired in #440), so no search resync is needed.',
    );
  }
}

main()
  .catch((error) => {
    console.error('fix1634WhyBulletFabricationPurge failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
