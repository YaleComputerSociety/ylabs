import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { personProfileSourceMatchesEntity } from '../scrapers/utils/personProfileEntityMatch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const NAMED_SLUGS = [
  'crewdson-lab-gc58',
  'robinson-40tim',
  'gage-mfg6',
  'deamer-md33',
  'messer-lab-sdm24',
  'roberts-cer63',
];

function fieldProvenanceSourceUrl(entity: any, field: string): string {
  const fp = entity.fieldProvenance?.[field];
  if (Array.isArray(fp)) return fp.map((p: any) => p?.sourceUrl).filter(Boolean).join(' | ');
  return fp?.sourceUrl || '';
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
      recentGrants: 1,
      fieldProvenance: 1,
      studentVisibilityTier: 1,
    })
    .toArray();

  const cohort = rows.filter((e: any) => textValue(e.school) !== 'School of Medicine');
  console.log(`detector cohort (student_ready, medicine.yale.edu fullDescription provenance, school != SoM): ${cohort.length}`);

  console.log('\n--- named examples from issue #1671 ---');
  for (const slug of NAMED_SLUGS) {
    const e = rows.find((r: any) => r.slug === slug);
    if (!e) {
      console.log(`${slug}: NOT FOUND in detector query (may not be student_ready or provenance missing)`);
      continue;
    }
    const currentGateAllows = personProfileSourceMatchesEntity(fieldProvenanceSourceUrl(e, 'fullDescription'), e as any);
    console.log(`\n${slug}`);
    console.log(`  school: ${e.school}`);
    console.log(`  fullDescription provenance sourceUrl: ${fieldProvenanceSourceUrl(e, 'fullDescription')}`);
    console.log(`  current personProfileSourceMatchesEntity allows this URL: ${currentGateAllows}`);
    console.log(`  fullDescription: ${textValue(e.fullDescription).slice(0, 220)}`);
    console.log(`  researchAreas: ${JSON.stringify(e.researchAreas)}`);
    console.log(`  researchAreas provenance sourceUrl: ${fieldProvenanceSourceUrl(e, 'researchAreas')}`);
  }

  console.log('\n--- full cohort (slug, school, current-gate-verdict) ---');
  for (const e of cohort as any[]) {
    const url = fieldProvenanceSourceUrl(e, 'fullDescription');
    const allows = personProfileSourceMatchesEntity(url, e as any);
    console.log(`${allows ? 'ALLOWS(gap)' : 'blocked-by-current-gate'}  ${e.slug}  school=${e.school}  url=${url}`);
  }

  await mongoose.disconnect();
}

function textValue(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
