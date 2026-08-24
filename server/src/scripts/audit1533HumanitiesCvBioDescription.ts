import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { repairPersonBiographyLeakedDescription } from '../utils/researchEntityBiographyDescriptionRepair';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const EXAMPLE_IDS = [
  '6a058d1eba66f3c14bd85400',
  '6a058d82ba66f3c14bd85b08',
  '6a058e32ba66f3c14bd870be',
  '6a058dcfba66f3c14bd8607a',
  '6a058d6fba66f3c14bd859bb',
  '6a058d5cba66f3c14bd85853',
  '6a058da2ba66f3c14bd85d54',
];

async function main(): Promise<void> {
  const uri = process.env.MONGODBURL || '';
  const pathname = new URL(uri).pathname;
  if (pathname !== '/Development') {
    console.error(`Refusing to run: MONGODBURL pathname is ${pathname}, not /Development`);
    process.exitCode = 1;
    return;
  }
  await initializeConnections();

  console.log('=== Example _ids from issue #1533 ===');
  for (const id of EXAMPLE_IDS) {
    const entity: any = await ResearchEntity.findById(id)
      .select('_id slug kind entityType studentVisibilityTier archived shortDescription fullDescription researchAreas')
      .lean();
    if (!entity) {
      console.log(`${id}: NOT FOUND`);
      continue;
    }
    const result = repairPersonBiographyLeakedDescription({
      fullDescription: entity.fullDescription,
      shortDescription: entity.shortDescription,
      researchAreas: entity.researchAreas,
    });
    console.log(
      `${id} slug=${entity.slug} kind=${entity.kind} entityType=${entity.entityType} tier=${entity.studentVisibilityTier} archived=${entity.archived} repairOutcome=${result.outcome}`,
    );
    console.log('  OLD FULL:', JSON.stringify(entity.fullDescription).slice(0, 220));
    console.log('  NEW FULL:', JSON.stringify(result.fullDescription).slice(0, 220));
    console.log('  NEW SHORT:', JSON.stringify(result.shortDescription).slice(0, 220));
  }

  console.log('\n=== Broader cohort scan (student_ready, live, has fullDescription) ===');
  const candidates = await ResearchEntity.find({
    studentVisibilityTier: 'student_ready',
    archived: { $ne: true },
    fullDescription: { $type: 'string', $ne: '' },
  })
    .select('_id slug kind entityType fullDescription shortDescription researchAreas')
    .lean();
  console.log(`Scanned ${candidates.length} live student_ready entities with a fullDescription`);

  const degreeListLead =
    /^\s*(?:B\.?\s?A\.?|A\.?\s?B\.?|M\.?\s?A\.?|M\.?\s?S\.?|M\.?\s?Arch\.?|M\.?\s?F\.?\s?A\.?|Ph\.?\s?D\.?|M\.?\s?D\.?|B\.?\s?Litt\.?|Hon\.?)\.?,/;

  let degreeListLeadCount = 0;
  let stillUnchangedCount = 0;
  const stillUnchangedSamples: Array<{ id: string; slug: string; full: string }> = [];
  const nowFixedSamples: Array<{ id: string; slug: string; oldFull: string; newFull: string; outcome: string }> = [];

  for (const entity of candidates) {
    const full = typeof entity.fullDescription === 'string' ? entity.fullDescription : '';
    const isDegreeListLead = degreeListLead.test(full);
    if (!isDegreeListLead) continue;
    degreeListLeadCount += 1;

    const result = repairPersonBiographyLeakedDescription({
      fullDescription: entity.fullDescription,
      shortDescription: entity.shortDescription,
      researchAreas: entity.researchAreas,
    });
    const stillHasDegreeListLead = degreeListLead.test(result.fullDescription);
    if (result.outcome === 'unchanged' || stillHasDegreeListLead) {
      stillUnchangedCount += 1;
      if (stillUnchangedSamples.length < 30) {
        stillUnchangedSamples.push({ id: String(entity._id), slug: entity.slug, full: full.slice(0, 240) });
      }
    } else if (nowFixedSamples.length < 30) {
      nowFixedSamples.push({
        id: String(entity._id),
        slug: entity.slug,
        oldFull: full.slice(0, 160),
        newFull: result.fullDescription.slice(0, 160),
        outcome: result.outcome,
      });
    }
  }

  console.log(`Degree-list-lead fullDescriptions (sub-shape A signal): ${degreeListLeadCount}`);
  console.log(`Still degree-list-lead or unchanged after repair (residual gap): ${stillUnchangedCount}`);

  console.log('\nSamples (still broken):');
  for (const s of stillUnchangedSamples) console.log(`  ${s.id} ${s.slug} :: ${s.full}`);

  console.log('\nSamples (now fixed):');
  for (const s of nowFixedSamples) {
    console.log(`  ${s.id} ${s.slug} [${s.outcome}]`);
    console.log(`    OLD: ${s.oldFull}`);
    console.log(`    NEW: ${s.newFull}`);
  }

  console.log('\n=== No-research-signal CV-bio cohort (sub-shape B) ===');
  const { describesResearchFocus } = await import('../utils/researchEntityDescriptionQuality');
  let noSignalCount = 0;
  let noSignalNowFixedCount = 0;
  const noSignalSamples: Array<{ id: string; slug: string; outcome: string; newFull: string }> = [];
  for (const entity of candidates) {
    const full = typeof entity.fullDescription === 'string' ? entity.fullDescription : '';
    if (!full || describesResearchFocus(full)) continue;
    if (entity.kind !== 'individual' && entity.entityType !== 'LAB') continue;
    noSignalCount += 1;
    const result = repairPersonBiographyLeakedDescription({
      fullDescription: entity.fullDescription,
      shortDescription: entity.shortDescription,
      researchAreas: entity.researchAreas,
    });
    if (result.outcome !== 'unchanged') {
      noSignalNowFixedCount += 1;
      if (noSignalSamples.length < 30) {
        noSignalSamples.push({
          id: String(entity._id),
          slug: entity.slug,
          outcome: result.outcome,
          newFull: result.fullDescription.slice(0, 160),
        });
      }
    }
  }
  console.log(`No-research-focus-signal live individual/LAB entities: ${noSignalCount}`);
  console.log(`Of those, now resynthesized/blanked by repair (was previously unchanged=served raw): ${noSignalNowFixedCount}`);
  for (const s of noSignalSamples) {
    console.log(`  ${s.id} ${s.slug} [${s.outcome}] :: ${s.newFull}`);
  }
}

main()
  .catch((error) => {
    console.error('audit1533HumanitiesCvBioDescription failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
