import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';

import { sanitizeServedResearchEntityCopyFields } from '../utils/researchEntityDescriptionText';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SENTENCE_INITIAL_FIRST_PERSON_OPENER =
  /^(?:I['’](?:m|ve|d|ll)\b|I\s+(?:am|have|had|was|study|studies|studied|investigate|examine|explore|use|focus|focused|work|works|research|develop|lead|leads|direct|analyze|apply|combine|seek|aim|began|started|joined|received|earned|hold|teach|remain|became|would|run|serve)\b|(?:My|Our)\s+\w+|We\s+\w+|Welcome to\b)/;

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
    .find({ archived: { $ne: true }, studentVisibilityTier: 'student_ready' })
    .toArray();
  console.log(`live student_ready total: ${rows.length}`);

  const storedFirstPerson = rows.filter(
    (e: any) => typeof e.fullDescription === 'string' && SENTENCE_INITIAL_FIRST_PERSON_OPENER.test(e.fullDescription),
  );
  console.log(`stored fullDescription matches first-person probe: ${storedFirstPerson.length}`);

  const survivors: any[] = [];
  let blankedCount = 0;
  let transformedCount = 0;
  for (const e of storedFirstPerson) {
    const served = sanitizeServedResearchEntityCopyFields(e as any);
    const servedFull = typeof served.fullDescription === 'string' ? served.fullDescription : '';
    if (!servedFull) {
      blankedCount++;
    } else if (SENTENCE_INITIAL_FIRST_PERSON_OPENER.test(servedFull)) {
      survivors.push({ e, servedFull });
    } else {
      transformedCount++;
    }
  }
  console.log(`survive serve still first-person: ${survivors.length}`);
  console.log(`blanked to empty: ${blankedCount}`);
  console.log(`transformed (no longer first-person, non-empty): ${transformedCount}`);

  const byEntityType: Record<string, number> = {};
  const weCount = survivors.filter((s) => /(^|[.!?]\s+)We\s+\w+/.test(s.servedFull)).length;
  const ourNounCount = survivors.filter(
    (s) => /(^|[.!?]\s+)Our\s+(?!careers?\b|group\b|research\b|laboratory\b|lab\b|team\b|work\b|mission\b|program\b)\w+/.test(s.servedFull),
  ).length;
  const iVerbCount = survivors.filter(
    (s) => /(^|[.!?]\s+)I\s+(?!am\b|['’]m\b)\w+/.test(s.servedFull),
  ).length;
  const greetingCount = survivors.filter((s) => /^welcome to\b/i.test(s.servedFull)).length;
  for (const s of survivors) {
    const key = `${s.e.entityType || 'UNKNOWN'}/${s.e.kind || 'n/a'}`;
    byEntityType[key] = (byEntityType[key] || 0) + 1;
  }

  console.log(`\nopener-shape breakdown (non-exclusive counts):`);
  console.log(`  We <verb> openers: ${weCount}`);
  console.log(`  Our <other-noun> openers: ${ourNounCount}`);
  console.log(`  I <verb> openers (excl. I am): ${iVerbCount}`);
  console.log(`  greeting survivors: ${greetingCount}`);
  console.log(`\nby entityType/kind:`);
  for (const [k, v] of Object.entries(byEntityType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }

  console.log(`\nsample survivors:`);
  for (const s of survivors.slice(0, 8)) {
    console.log(`\n--- ${s.e.slug} (${s.e.entityType}/${s.e.kind}) ---`);
    console.log(s.servedFull.slice(0, 160));
  }

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
