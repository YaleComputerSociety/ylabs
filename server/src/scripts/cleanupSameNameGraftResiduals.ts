/**
 * Complete the #1256 same-name-collision graft purge (PR #1270) by repairing the
 * two residuals it leaves on live `student_ready` docs (issue #1273):
 *
 * 1. `nicholson-cn96` (early-modern English literature) was left with empty
 *    `researchAreas` because every original area was a grafted clinical string
 *    and none was a legitimate discipline area; an entity with zero areas is
 *    invisible to the topical browse/facet (#349). Its correct discipline areas
 *    are restored from the `Humanities & Arts` catalog, supported by its own
 *    `fullDescription`.
 * 2. `samuels-mas278` (19th-c. French literature) had its wrong-person
 *    `medicine.yale.edu` `websiteUrl` cleared by #1270, but the identical
 *    same-name medical profile URL is still recorded in `sourceUrls[]` - a
 *    latent re-graft / mis-attribution source that is dropped here.
 *
 * Curated, drift-guarded, field-scoped (mirrors cleanupGluedRoleTrackResearchAreas
 * and #1270): areas are only restored when currently empty, and only the matching
 * medical-host `sourceUrls` entry is dropped. Dry-run-first. Apply requires
 * `--apply`; production writes are blocked by assertScriptApplyAllowed unless
 * SCRAPER_ENV=production and CONFIRM_PROD_SCRAPE=true. Only entities whose plan
 * actually changes are written, and each applied batch is re-synced to the
 * Meilisearch research index so the index never drifts from Mongo.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { ResearchEntity } from '../models/researchEntity';
import { syncEntities } from '../services/meiliSyncService';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import {
  planSameNameGraftCleanup,
  summarizeSameNameGraftPlans,
  type SameNameGraftDirective,
  type SameNameGraftPlan,
} from './cleanupSameNameGraftResidualsCore';

const SCRIPT_NAME = 'cleanupSameNameGraftResiduals';

const DIRECTIVES: SameNameGraftDirective[] = [
  {
    slug: 'nicholson-cn96',
    removeAreas: [],
    fallbackAreasWhenEmpty: ['Literature', 'British Literature', 'Renaissance Studies'],
  },
  {
    slug: 'samuels-mas278',
    removeAreas: [],
    clearWebsiteHostIncludes: 'medicine.yale.edu',
  },
];

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const url = process.env.MONGODBURL;
  if (!url) {
    console.error('MONGODBURL is not set');
    process.exit(1);
  }
  const pathname = new URL(url).pathname;

  const guard = assertScriptApplyAllowed({ apply, scriptName: SCRIPT_NAME, mongoUrl: url });

  await mongoose.connect(url);
  const collection = mongoose.connection.collection('research_entities');
  console.log(`mode: ${apply ? 'APPLY' : 'DRY-RUN'} | db: ${guard.dbLabel} (${pathname})`);

  const plans: SameNameGraftPlan[] = [];
  const appliedIds: mongoose.Types.ObjectId[] = [];
  let mutated = 0;

  for (const directive of DIRECTIVES) {
    const doc = await collection.findOne<{
      _id: mongoose.Types.ObjectId;
      researchAreas?: unknown;
      websiteUrl?: unknown;
      sourceUrls?: unknown;
      shortDescription?: unknown;
      fullDescription?: unknown;
    }>({ slug: directive.slug });
    if (!doc) {
      console.log(`\n[${directive.slug}] NOT FOUND`);
      continue;
    }
    const plan = planSameNameGraftCleanup({ slug: directive.slug, ...doc }, directive);
    plans.push(plan);

    console.log(`\n[${directive.slug}] changed=${plan.changed}`);
    console.log(`  areas before (${plan.areasBefore.length}): ${JSON.stringify(plan.areasBefore)}`);
    console.log(`  areas after  (${plan.areasAfter.length}): ${JSON.stringify(plan.areasAfter)}`);
    if (plan.removedAreas.length > 0) {
      console.log(`  removed areas: ${JSON.stringify(plan.removedAreas)}`);
    }
    if (plan.addedAreas.length > 0) {
      console.log(`  restored areas: ${JSON.stringify(plan.addedAreas)}`);
    }
    if (plan.missingRemoveAreas.length > 0) {
      console.log(`  DRIFT (directed removals not present): ${JSON.stringify(plan.missingRemoveAreas)}`);
    }
    if (plan.websiteCleared) {
      console.log(`  cleared websiteUrl: ${plan.websiteBefore}`);
    }
    if (plan.sourceUrlsRemoved.length > 0) {
      console.log(`  dropped sourceUrls: ${JSON.stringify(plan.sourceUrlsRemoved)}`);
    }
    if (plan.shortChanged) {
      console.log(`  short before: ${plan.shortBefore}`);
      console.log(`  short after : ${plan.shortAfter}`);
    }

    if (apply && plan.changed) {
      const set: Record<string, unknown> = {};
      if (
        plan.areasAfter.length !== plan.areasBefore.length ||
        plan.areasAfter.some((area, index) => area !== plan.areasBefore[index])
      ) {
        set.researchAreas = plan.areasAfter;
      }
      if (plan.websiteCleared) set.websiteUrl = '';
      if (plan.shortChanged) set.shortDescription = plan.shortAfter;
      if (plan.sourceUrlsRemoved.length > 0) {
        const removed = new Set(plan.sourceUrlsRemoved);
        const keptSourceUrls = (Array.isArray(doc.sourceUrls) ? doc.sourceUrls : [])
          .filter((value): value is string => typeof value === 'string')
          .filter((value) => !removed.has(value.trim()));
        set.sourceUrls = keptSourceUrls;
      }
      await collection.updateOne({ _id: doc._id }, { $set: set });
      appliedIds.push(doc._id);
      mutated += 1;
      const verify = await collection.findOne<{ researchAreas?: unknown; websiteUrl?: unknown }>({
        _id: doc._id,
      });
      console.log(
        `  applied. verified areas=${JSON.stringify(verify?.researchAreas)} website=${JSON.stringify(verify?.websiteUrl)}`,
      );
    }
  }

  if (apply && appliedIds.length > 0) {
    const fresh = await ResearchEntity.find({ _id: { $in: appliedIds } }).lean();
    await syncEntities('researchEntity', fresh);
    console.log(`\nMeilisearch: re-synced ${fresh.length} entities`);
  }

  const summary = summarizeSameNameGraftPlans(plans);
  console.log(`\nsummary: ${JSON.stringify(summary)}`);
  console.log(
    `\n${apply ? `APPLIED to ${mutated} entities` : 'dry-run complete; re-run with --apply'}`,
  );
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
