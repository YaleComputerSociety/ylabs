import 'dotenv/config';
import mongoose from 'mongoose';
import {
  isResearchAreaLabelLeakage,
  splitGluedRoleTrackLabels,
} from '../scrapers/researchAreaCanonicalization';

const TARGET_SLUGS = ['padmanabhan-lab-np274', 'dept-seas-hui-cao'];

interface EntityPlan {
  slug: string;
  found: boolean;
  before: string[];
  after: string[];
  removed: string[];
  unsafe: Array<{ entry: string; missingPieces: string[] }>;
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function planForEntity(slug: string, researchAreas: unknown): EntityPlan {
  const before = Array.isArray(researchAreas)
    ? researchAreas.filter((value): value is string => typeof value === 'string')
    : [];
  const cleanSet = new Set(before.map(normalize));
  const removed: string[] = [];
  const unsafe: EntityPlan['unsafe'] = [];

  for (const entry of before) {
    const pieces = splitGluedRoleTrackLabels(entry);
    const isGlued = pieces.length > 1;
    if (!isGlued) continue;
    const topicPieces = pieces.filter((piece) => !isResearchAreaLabelLeakage(piece));
    const missingPieces = topicPieces.filter((piece) => !cleanSet.has(normalize(piece)));
    if (missingPieces.length > 0) {
      unsafe.push({ entry, missingPieces });
      continue;
    }
    removed.push(entry);
  }

  const removedSet = new Set(removed.map(normalize));
  const after = before.filter((entry) => !removedSet.has(normalize(entry)));
  return { slug, found: true, before, after, removed, unsafe };
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const url = process.env.MONGODBURL;
  if (!url) {
    console.error('MONGODBURL is not set');
    process.exit(1);
  }
  const pathname = new URL(url).pathname;
  if (pathname !== '/Development') {
    console.error(`Refusing to run: MONGODBURL points at ${pathname}, not /Development`);
    process.exit(1);
  }

  await mongoose.connect(url);
  const collection = mongoose.connection.collection('research_entities');
  console.log(`mode: ${apply ? 'APPLY' : 'DRY-RUN'} | db: ${pathname}`);

  let mutated = 0;
  for (const slug of TARGET_SLUGS) {
    const doc = await collection.findOne<{ researchAreas?: unknown }>({ slug });
    if (!doc) {
      console.log(`\n[${slug}] NOT FOUND`);
      continue;
    }
    const plan = planForEntity(slug, doc.researchAreas);
    console.log(`\n[${slug}]`);
    console.log(`  before (${plan.before.length}): ${JSON.stringify(plan.before)}`);
    console.log(
      `  glued entries to remove (${plan.removed.length}): ${JSON.stringify(plan.removed)}`,
    );
    if (plan.unsafe.length > 0) {
      console.log(
        `  SKIPPED (clean pieces missing, would lose signal): ${JSON.stringify(plan.unsafe)}`,
      );
    }
    console.log(`  after (${plan.after.length}): ${JSON.stringify(plan.after)}`);

    if (apply && plan.removed.length > 0) {
      await collection.updateOne({ slug }, { $set: { researchAreas: plan.after } });
      const verify = await collection.findOne<{ researchAreas?: unknown }>({ slug });
      console.log(`  applied. verified researchAreas: ${JSON.stringify(verify?.researchAreas)}`);
      mutated += 1;
    }
  }

  console.log(
    `\n${apply ? `APPLIED to ${mutated} entities` : 'dry-run complete; re-run with --apply'}`,
  );
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
