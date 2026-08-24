import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import {
  fullDescriptionQuality,
  shortDescriptionQuality,
} from '../utils/researchEntityDescriptionQuality';
import {
  sanitizeResearchEntityDescription,
  sanitizeResearchEntityShortDescription,
} from '../utils/descriptionHygiene';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const STRICT_CHROME_PATTERN =
  /\bYSM Researchers?\b|ResearchersView|View\s+\d+\s+(?:Common|Related)\s+Publications?|\bTitles(?=[A-Z])|\bBiography(?=[A-Z])|\bOverview(?=[A-Z])|\bEmail:\s*\S+@\S+\.\w+Phone:|\bPhone:\s*[\d().\s-]+\S/;
const BROAD_WORD_JAM_PATTERN = /[a-z][A-Z]/;

const FLAGSHIP_SLUGS = [
  'dept-cs-mark-gerstein',
  'nih-pi-david-fink',
  'zeiss-lab-cjz4',
  'miller-lab-jem275',
  'diano-lab-sd69',
  'choma-lab-mac279',
];

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
    .find({ studentVisibilityTier: 'student_ready' })
    .project({
      _id: 1,
      slug: 1,
      name: 1,
      fullDescription: 1,
      shortDescription: 1,
      studentVisibilityReasons: 1,
    })
    .toArray();

  console.log(`total student_ready rows: ${rows.length}`);

  const strict: any[] = [];
  const broad: any[] = [];
  for (const row of rows) {
    const full = String(row.fullDescription || '');
    if (!full) continue;
    if (STRICT_CHROME_PATTERN.test(full)) strict.push(row);
    if (BROAD_WORD_JAM_PATTERN.test(full)) broad.push(row);
  }

  console.log(`strict chrome-signature matches: ${strict.length}`);
  console.log(`broad [a-z][A-Z] word-jam matches: ${broad.length}`);

  console.log('\n--- flagship examples: before/after fix ---');
  for (const slug of FLAGSHIP_SLUGS) {
    const row = rows.find((r) => r.slug === slug);
    if (!row) {
      console.log(`${slug}: NOT FOUND among student_ready rows`);
      continue;
    }
    const rawFull = String(row.fullDescription || '');
    const beforeQuality = fullDescriptionQuality(rawFull);
    const sanitizedFull = sanitizeResearchEntityDescription(rawFull);
    const afterQuality = fullDescriptionQuality(sanitizedFull);
    console.log(`\n${slug} (${row._id}):`);
    console.log(`  reasons: ${JSON.stringify(row.studentVisibilityReasons)}`);
    console.log(`  raw:        ${rawFull.slice(0, 160)}`);
    console.log(`  sanitized:  ${sanitizedFull.slice(0, 160)}`);
    console.log(
      `  before: isUseful=${beforeQuality.isUseful} flags=${JSON.stringify(beforeQuality.flags)}`,
    );
    console.log(
      `  after:  isUseful=${afterQuality.isUseful} flags=${JSON.stringify(afterQuality.flags)}`,
    );

    const rawShort = String(row.shortDescription || '');
    if (rawShort) {
      const sanitizedShort = sanitizeResearchEntityShortDescription(rawShort);
      const beforeShortQuality = shortDescriptionQuality(rawShort, rawFull);
      const afterShortQuality = shortDescriptionQuality(sanitizedShort, sanitizedFull);
      console.log(`  short raw:       ${rawShort.slice(0, 140)}`);
      console.log(`  short sanitized: ${sanitizedShort.slice(0, 140)}`);
      console.log(
        `  short before: isUseful=${beforeShortQuality.isUseful} flags=${JSON.stringify(beforeShortQuality.flags)}`,
      );
      console.log(
        `  short after:  isUseful=${afterShortQuality.isUseful} flags=${JSON.stringify(afterShortQuality.flags)}`,
      );
    }
  }

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
