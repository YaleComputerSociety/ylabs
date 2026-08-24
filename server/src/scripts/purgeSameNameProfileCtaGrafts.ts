import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { syncEntities } from '../services/meiliSyncService';
import {
  SAME_NAME_PROFILE_CTA_GRAFTS,
  planSourceUrlPurge,
  shouldClearGraftedWebsite,
} from './purgeSameNameProfileCtaGraftsCore';

const __filename = fileURLToPath(import.meta.url);

interface EntityPlan {
  slug: string;
  id: string;
  set: Record<string, unknown>;
  notes: string[];
}

function buildPlan(
  slug: string,
  wrongUrl: string,
  doc: Record<string, unknown>,
): EntityPlan | null {
  const set: Record<string, unknown> = {};
  const notes: string[] = [];

  if (shouldClearGraftedWebsite(doc.websiteUrl, wrongUrl)) {
    set.websiteUrl = '';
    notes.push(`websiteUrl: cleared same-name medical profile ${JSON.stringify(doc.websiteUrl)}`);
  }

  const sourcePurge = planSourceUrlPurge(doc.sourceUrls, wrongUrl);
  if (sourcePurge.safeToApply) {
    set.sourceUrls = sourcePurge.after;
    notes.push(
      `sourceUrls: removed same-name medical profile ${JSON.stringify(sourcePurge.removed)} (${sourcePurge.after.length} source route(s) remain)`,
    );
  } else if (sourcePurge.removed.length > 0) {
    notes.push(
      `sourceUrls: leaving ${JSON.stringify(sourcePurge.removed)} in place - it is the only source route; needs correct-URL acquisition before removal`,
    );
  }

  if (Object.keys(set).length === 0) return null;
  return { slug, id: String(doc._id), set, notes };
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

  const plans: EntityPlan[] = [];
  for (const [slug, wrongUrl] of Object.entries(SAME_NAME_PROFILE_CTA_GRAFTS)) {
    const doc = await collection.findOne<Record<string, unknown>>({ slug });
    if (!doc) {
      console.log(`\n[${slug}] not found - skipping`);
      continue;
    }
    const plan = buildPlan(slug, wrongUrl, doc);
    if (!plan) {
      console.log(`\n[${slug}] no removable graft - no change`);
      continue;
    }
    plans.push(plan);
    console.log(`\n[${slug}]`);
    for (const note of plan.notes) console.log(`  ${note}`);
  }

  console.log(`\nentities needing purge: ${plans.length}`);

  if (apply && plans.length > 0) {
    for (const plan of plans) {
      await collection.updateOne(
        { _id: new mongoose.Types.ObjectId(plan.id) },
        { $set: plan.set },
      );
    }
    const ids = plans.map((p) => new mongoose.Types.ObjectId(p.id));
    const updatedDocs = await collection.find({ _id: { $in: ids } }).toArray();
    await syncEntities('researchEntity', updatedDocs);
    console.log(`\nAPPLIED to ${plans.length} entities and re-synced them to Meilisearch.`);
  } else if (!apply) {
    console.log('\ndry-run complete; re-run with --apply to write and re-sync.');
  }

  await mongoose.disconnect();
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
