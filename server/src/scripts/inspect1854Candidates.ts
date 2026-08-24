import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { Observation } from '../models/observation';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const RESEARCH_HINT =
  /\b(?:research|lab|laboratory|study|studies|studying|investigate|investigates|investigated|explore|explores|focus|focuses|focusing|works?\s+on|conducts|uses|develops|examines|examining|analysis|method|methods|model|models|projects?|theory|algorithm|algorithms|approach|approaches|data|paper|papers?|publications?)\b/i;

const SLUGS = (process.argv.slice(2).length ? process.argv.slice(2) : ['gao-lab-xg23', 'zarin-cz59']);

async function main(): Promise<void> {
  await initializeConnections();
  try {
    for (const slug of SLUGS) {
      const doc: any = await ResearchEntity.findOne({ slug }).lean();
      console.log(`\n===== ${slug} (${doc?.entityType}/${doc?.studentVisibilityTier}) =====`);
      for (const field of ['shortDescription', 'fullDescription', 'profileSynthesisDescription']) {
        const value = typeof doc?.[field] === 'string' ? doc[field] : '';
        const match = value.match(RESEARCH_HINT);
        console.log(
          `-- ${field}: len=${value.length} hint=${match ? `${match[0]}@${match.index}` : 'NONE'}`,
        );
        if (value) console.log(`   ${value.slice(0, 300)}`);
      }
      const observations: any[] = await Observation.find(
        { entityKey: slug, field: { $in: ['fullDescription', 'shortDescription'] } },
        { field: 1, value: 1, sourceKey: 1, observedAt: 1, confidence: 1 },
      )
        .sort({ observedAt: -1 })
        .lean();
      for (const observation of observations) {
        const value = typeof observation.value === 'string' ? observation.value : '';
        const match = value.match(RESEARCH_HINT);
        console.log(
          `   OBS ${observation.field} len=${value.length} src=${observation.sourceKey} conf=${observation.confidence} hint=${match ? `${match[0]}@${match.index}` : 'NONE'}`,
        );
      }
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
