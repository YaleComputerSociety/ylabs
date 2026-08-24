import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SECOND_PERSON_PATTERN = /\byour\b|\byou\b/i;
const VACUOUS_ALIGN_PATTERN = /^(research( area| focus)?s?|lab focus)\s+align(s)?\s+with\b/i;

async function main(): Promise<void> {
  const uri = process.env.MONGODBURL || '';
  const pathname = new URL(uri).pathname;
  if (pathname !== '/Development') {
    console.error(`Refusing to run: MONGODBURL pathname is ${pathname}, not /Development`);
    process.exitCode = 1;
    return;
  }
  await initializeConnections();

  const candidates = await ResearchEntity.find({
    studentVisibilityTier: 'student_ready',
    archived: { $ne: true },
    'studentDecisionExplanation.why': { $exists: true, $type: 'array', $ne: [] },
  })
    .select('_id slug studentDecisionExplanation researchAreas fullDescription')
    .lean();

  console.log(`Live student_ready cohort with non-empty why[]: ${candidates.length}`);

  let secondPersonEntities = 0;
  let vacuousEntities = 0;
  let secondPersonBullets = 0;
  let vacuousBullets = 0;
  const secondPersonSamples: string[] = [];
  const vacuousSamples: string[] = [];

  for (const entity of candidates as any[]) {
    const why: unknown = entity.studentDecisionExplanation?.why;
    if (!Array.isArray(why)) continue;
    let hasSecondPerson = false;
    let hasVacuous = false;
    for (const bulletRaw of why) {
      const bullet = String(bulletRaw);
      if (SECOND_PERSON_PATTERN.test(bullet)) {
        hasSecondPerson = true;
        secondPersonBullets += 1;
        if (secondPersonSamples.length < 8) secondPersonSamples.push(`${entity._id} :: ${bullet}`);
      }
      if (VACUOUS_ALIGN_PATTERN.test(bullet.trim())) {
        hasVacuous = true;
        vacuousBullets += 1;
        if (vacuousSamples.length < 8) vacuousSamples.push(`${entity._id} :: ${bullet}`);
      }
    }
    if (hasSecondPerson) secondPersonEntities += 1;
    if (hasVacuous) vacuousEntities += 1;
  }

  console.log(`\nSecond-person entities: ${secondPersonEntities} (bullets: ${secondPersonBullets})`);
  secondPersonSamples.forEach((s) => console.log(`  ${s}`));
  console.log(`\nVacuous align-template entities: ${vacuousEntities} (bullets: ${vacuousBullets})`);
  vacuousSamples.forEach((s) => console.log(`  ${s}`));

  console.log('\n=== Issue example _ids ===');
  const EXAMPLE_IDS = [
    '6a058da2ba66f3c14bd85d45',
    '6a057e0913fc60d57ec2a941',
    '6a056cbe14107ca43f8a7ce9',
    '6a05677a7c6d4fba869fbb4b',
    '6a056c7614107ca43f8a6f71',
  ];
  for (const id of EXAMPLE_IDS) {
    const entity: any = await ResearchEntity.findById(id)
      .select('_id slug studentDecisionExplanation researchAreas fullDescription studentVisibilityTier archived')
      .lean();
    if (!entity) {
      console.log(`${id}: NOT FOUND`);
      continue;
    }
    console.log(
      `${id} slug=${entity.slug} tier=${entity.studentVisibilityTier} archived=${entity.archived}`,
    );
    console.log('  why:', JSON.stringify(entity.studentDecisionExplanation?.why));
    console.log('  researchAreas:', JSON.stringify(entity.researchAreas)?.slice(0, 200));
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
