import 'dotenv/config';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';

const includeHandles = process.argv.includes('--include-handles');
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const sampleLimit = Math.min(25, Math.max(0, Number(limitArg?.split('=')[1] || 10)));

async function main() {
  await initializeConnections();
  const [total, conflicts] = await Promise.all([
    ResearchEntity.countDocuments({ archived: { $ne: true } }),
    ResearchEntity.find({
      archived: { $ne: true },
      'qualitySummary.repairFlags': 'pi_identity_conflict',
    })
      .select(includeHandles ? '_id slug' : '_id')
      .limit(sampleLimit)
      .lean(),
  ]);
  const conflictCount = await ResearchEntity.countDocuments({
    archived: { $ne: true },
    'qualitySummary.repairFlags': 'pi_identity_conflict',
  });
  console.log(JSON.stringify({
    mode: 'read-only',
    totalResearchEntities: total,
    piIdentityConflicts: conflictCount,
    samples: includeHandles ? conflicts.map((row: any) => ({ id: String(row._id), slug: row.slug })) : [],
  }, null, 2));
}

void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
