import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function textValue(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function provenanceFor(entity: any, field: string): any {
  return entity.fieldProvenance?.[field];
}

async function main(): Promise<void> {
  const uri = process.env.MONGODBURL as string;
  const parsed = new URL(uri);
  if (parsed.pathname !== '/Development') {
    console.error(`refusing to run: MONGODBURL pathname is ${parsed.pathname}, not /Development`);
    process.exit(1);
  }
  await mongoose.connect(uri);
  const entities = mongoose.connection.db!.collection('research_entities');

  const rows = await entities
    .find({
      archived: { $ne: true },
      studentVisibilityTier: 'student_ready',
      'fieldProvenance.fullDescription.sourceUrl': { $regex: /medicine\.yale\.edu/i },
    })
    .project({
      _id: 1,
      slug: 1,
      name: 1,
      displayName: 1,
      school: 1,
      schools: 1,
      departments: 1,
      sourceUrls: 1,
      fullDescription: 1,
      shortDescription: 1,
      researchAreas: 1,
      fieldProvenance: 1,
    })
    .toArray();

  const cohort = rows.filter((e: any) => textValue(e.school) !== 'School of Medicine');
  console.log(`cohort size: ${cohort.length}\n`);

  for (const e of cohort as any[]) {
    console.log('='.repeat(100));
    console.log(`slug: ${e.slug}   _id: ${e._id}`);
    console.log(`name: ${e.name || e.displayName}`);
    console.log(`school: ${e.school}   departments: ${JSON.stringify(e.departments)}`);
    console.log(`fullDescription provenance: ${JSON.stringify(provenanceFor(e, 'fullDescription'))}`);
    console.log(`fullDescription: ${textValue(e.fullDescription)}`);
    console.log(`shortDescription: ${textValue(e.shortDescription)}`);
    console.log(`researchAreas: ${JSON.stringify(e.researchAreas)}`);
    console.log(`researchAreas provenance: ${JSON.stringify(provenanceFor(e, 'researchAreas'))}`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
