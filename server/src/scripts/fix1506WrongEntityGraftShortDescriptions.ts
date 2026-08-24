/**
 * Corrects a short, explicit allowlist of research-entity `shortDescription`
 * values confirmed by manual review to be a wrong-entity topic graft: prose
 * that reads cleanly but describes a different lab's research than the
 * entity's own `fullDescription`/`researchAreas` (issue #1506). A general
 * topical-grounding detector for this shape was tried and rejected during
 * #1506's investigation - at any threshold precise enough to avoid blanking
 * legitimately-paraphrased shorts across the corpus, it also missed this
 * exact case - so each row here is a manually confirmed, one-off correction
 * rather than a heuristic sweep. Add a row only after confirming the graft
 * by hand.
 *
 * Dry-run-first. Apply requires `--confirm-wrong-entity-graft-fix`, is
 * blocked against production by `assertScriptApplyAllowed`, and only writes
 * a row whose current stored `shortDescription` still matches the exact
 * value recorded here (so a row already fixed by other means is skipped
 * rather than clobbered). Meilisearch is re-synced for changed entities
 * after an apply.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { syncEntities } from '../services/meiliSyncService';
import { buildResearchAreasCardSummary } from '../utils/researchEntityDescriptionQuality';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface WrongEntityGraftRow {
  slug: string;
  expectedCurrentShortDescription: string;
}

const WRONG_ENTITY_GRAFT_ROWS: readonly WrongEntityGraftRow[] = [
  {
    slug: 'cohen-lab-cohenls',
    expectedCurrentShortDescription:
      'Research connected to neurobiology and insect physiology, photoreceptor and optogenetics, and neuroscience and neural engineering.',
  },
];

interface WrongEntityGraftPlanRow {
  slug: string;
  id: string;
  before: string;
  after: string;
  changed: boolean;
  skippedReason?: 'not_found' | 'current_value_does_not_match' | 'no_replacement_available';
}

async function planWrongEntityGraftFix(): Promise<WrongEntityGraftPlanRow[]> {
  const plans: WrongEntityGraftPlanRow[] = [];
  for (const row of WRONG_ENTITY_GRAFT_ROWS) {
    const entity = await ResearchEntity.findOne({ slug: row.slug })
      .select('_id slug shortDescription researchAreas')
      .lean<{ _id: unknown; slug: string; shortDescription?: string; researchAreas?: unknown }>();
    if (!entity) {
      plans.push({ slug: row.slug, id: '', before: '', after: '', changed: false, skippedReason: 'not_found' });
      continue;
    }
    const current = typeof entity.shortDescription === 'string' ? entity.shortDescription : '';
    if (current !== row.expectedCurrentShortDescription) {
      plans.push({
        slug: row.slug,
        id: String(entity._id),
        before: current,
        after: current,
        changed: false,
        skippedReason: 'current_value_does_not_match',
      });
      continue;
    }
    const replacement = buildResearchAreasCardSummary(entity.researchAreas);
    if (!replacement) {
      plans.push({
        slug: row.slug,
        id: String(entity._id),
        before: current,
        after: current,
        changed: false,
        skippedReason: 'no_replacement_available',
      });
      continue;
    }
    plans.push({ slug: row.slug, id: String(entity._id), before: current, after: replacement, changed: true });
  }
  return plans;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const confirmed = args.includes('--confirm-wrong-entity-graft-fix');

  if (apply && !confirmed) {
    throw new Error('Apply mode requires --confirm-wrong-entity-graft-fix.');
  }

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'wrong-entity-graft short-description fix',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const plans = await planWrongEntityGraftFix();
    console.log(JSON.stringify(plans, null, 2));

    const changed = plans.filter((plan) => plan.changed);
    if (apply && changed.length > 0) {
      for (const plan of changed) {
        await ResearchEntity.updateOne({ _id: plan.id }, { $set: { shortDescription: plan.after } });
      }
      const freshDocs = await ResearchEntity.find({ _id: { $in: changed.map((plan) => plan.id) } }).lean();
      await syncEntities('researchEntity', freshDocs);
      console.log(`Applied ${changed.length} correction(s); synced ${freshDocs.length} entity doc(s) to Meilisearch.`);
    } else {
      console.log(`${changed.length} row(s) would change (dry-run).`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv[1]?.endsWith('fix1506WrongEntityGraftShortDescriptions.ts')) {
  main().catch(async (error) => {
    console.error('Failed to run wrong-entity-graft short-description fix:', error);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  });
}
