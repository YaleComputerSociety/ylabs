import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { isTemplatedKeywordStub } from './backfillDescriptionQualityCore';
import { isSyntheticResearchHomeMetadataDescription } from '../utils/researchEntityDescriptionText';
import { researchEntityServesPublicDetail } from '../services/researchEntityPublicDescription';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function main(): Promise<void> {
  const uri = process.env.MONGODBURL as string;
  const parsed = new URL(uri);
  if (parsed.pathname !== '/Development') {
    console.error(`refusing to run: MONGODBURL pathname is ${parsed.pathname}, not /Development`);
    process.exit(1);
  }
  console.log(`connected pathname: ${parsed.pathname}`);

  await mongoose.connect(uri);
  const entities = mongoose.connection.db!.collection('research_entities');

  const rows = await entities
    .find({
      archived: { $ne: true },
      fullDescription: { $regex: /\bis connected to\b/i },
    })
    .project({
      _id: 1,
      slug: 1,
      name: 1,
      entityType: 1,
      studentVisibilityTier: 1,
      fullDescription: 1,
      shortDescription: 1,
      researchAreas: 1,
    })
    .toArray();

  console.log(`live rows with "is connected to" in fullDescription: ${rows.length}`);
  const studentReady = rows.filter((r) => r.studentVisibilityTier === 'student_ready');
  console.log(`student_ready among them: ${studentReady.length}`);

  let nowBlocked = 0;
  for (const row of rows) {
    const full = String(row.fullDescription || '');
    const quality = isTemplatedKeywordStub(full);
    const serveGate = isSyntheticResearchHomeMetadataDescription(full);
    const servesDetail = researchEntityServesPublicDetail(row);
    if (serveGate) nowBlocked += 1;
    console.log(
      `\n${row.slug} (${row._id}) tier=${row.studentVisibilityTier} type=${row.entityType}`,
    );
    console.log(`  full: ${full.slice(0, 200)}`);
    console.log(
      `  quality.isTemplatedKeywordStub=${quality}  serveGate.isSynthetic=${serveGate}  servesPublicDetail=${servesDetail}`,
    );
  }
  console.log(`\nnow caught by isSyntheticResearchHomeMetadataDescription: ${nowBlocked}/${rows.length}`);

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
