/**
 * Repairs the 3 entities confirmed by the #1537 corpus audit as live
 * namesake-source-fusion cases: a Faculty-of-Arts-and-Sciences "<Surname> Lab"
 * whose only recorded sourceUrl is a coincidentally-same-surname
 * medicine.yale.edu profile page for a different person, whose content was
 * then fused (fabricated bridging prose) or garbled into the entity's own
 * description.
 *
 * - `graham-lab-tg296` (Russian, East European, and Eurasian Studies): fused
 *   with medicine.yale.edu/profile/thomas-graham into an invented
 *   neuroscience/immunology description.
 * - `kaliambou-lab-mk655` (Russian, East European, and Eurasian Studies):
 *   fused with medicine.yale.edu/profile/maria-kaliambou into an invented
 *   folklore/psychiatry description.
 * - `syrimis-lab-gs255` (Russian, East European, and Eurasian Studies): keyed
 *   onto medicine.yale.edu/profile/george-syrimis, producing a garbled
 *   bibliographic citation fragment as its description.
 *
 * All three are now rejected by the strengthened `personProfileSourceMatchesEntity`
 * surname-only-at-tolerant-host check (#1537). This script removes the
 * mismatched sourceUrl, supersedes the observations it produced (matching the
 * `observations:purge-miskeyed-profile-descriptions` pattern), and
 * rematerializes the affected fields so a fresh, source-backed value (or a
 * clean missing-description state, never fabricated prose) replaces the
 * corrupted one.
 *
 * Dry-run-first. Apply requires `--confirm-fix-1537-namesake-source-fusion`,
 * is blocked against production by `assertScriptApplyAllowed`, and
 * Meilisearch is re-synced for the changed entities after an apply.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { Observation } from '../models/observation';
import { materializeEntity } from '../scrapers/entityMaterializer';
import { personProfileSourceMatchesEntity } from '../scrapers/utils/personProfileEntityMatch';
import { syncEntities } from '../services/meiliSyncService';
import { runStudentVisibilityGate } from '../services/studentVisibilityGateService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { serializedDocumentId } from '../utils/idSerialization';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'research-entity:fix-1537-namesake-source-fusion';
const ROLLBACK_REASON =
  'namesake source-fusion: source names a different person than the entity, caught by the surname-only-at-tolerant-host check (#1537)';

const TARGET_SLUGS = ['graham-lab-tg296', 'kaliambou-lab-mk655', 'syrimis-lab-gs255'];

export interface NamesakeFusionEntityPlan {
  slug: string;
  found: boolean;
  entityId?: string;
  mismatchedSourceUrls: string[];
  sourceUrlsBefore?: string[];
  sourceUrlsAfter?: string[];
  observationIds: string[];
  observationFields: string[];
}

export async function planNamesakeFusionRepair(slug: string): Promise<NamesakeFusionEntityPlan> {
  const entity = await ResearchEntity.findOne({ slug })
    .select('slug name displayName school schools departments sourceUrls fullDescription recentGrants')
    .lean<Record<string, unknown> & { _id: unknown }>();
  if (!entity) return { slug, found: false, mismatchedSourceUrls: [], observationIds: [], observationFields: [] };

  const identity = {
    slug: entity.slug as string | undefined,
    name: entity.name as string | undefined,
    displayName: entity.displayName as string | undefined,
    school: entity.school as string | undefined,
    schools: entity.schools as string[] | undefined,
    departments: entity.departments as string[] | undefined,
    fullDescription: entity.fullDescription as string | undefined,
    recentGrants: entity.recentGrants as Array<{ title?: string; abstract?: string }> | undefined,
  };
  const sourceUrlsBefore = Array.isArray(entity.sourceUrls) ? (entity.sourceUrls as string[]) : [];
  const sourceUrlsAfter = sourceUrlsBefore.filter((url) =>
    personProfileSourceMatchesEntity(url, { ...identity, sourceUrls: sourceUrlsBefore }),
  );
  const mismatchedSourceUrls = sourceUrlsBefore.filter((url) => !sourceUrlsAfter.includes(url));

  const entityId = String(entity._id);
  const observations =
    mismatchedSourceUrls.length > 0
      ? await Observation.find({
          entityType: 'researchEntity',
          $or: [{ entityId: new mongoose.Types.ObjectId(entityId) }, { entityKey: slug }],
          sourceUrl: { $in: mismatchedSourceUrls },
          superseded: { $ne: true },
        })
          .select('_id field')
          .lean()
      : [];

  return {
    slug,
    found: true,
    entityId,
    mismatchedSourceUrls,
    sourceUrlsBefore,
    sourceUrlsAfter,
    observationIds: observations
      .map((observation) => serializedDocumentId(observation._id))
      .filter((id): id is string => Boolean(id)),
    observationFields: Array.from(new Set(observations.map((observation) => observation.field))).sort(),
  };
}

const CLEARABLE_FIELDS = ['fullDescription', 'shortDescription', 'researchAreas', 'methods', 'inferredPiUserId'];

async function applyPlan(plan: NamesakeFusionEntityPlan): Promise<void> {
  if (!plan.found || !plan.entityId) return;
  await ResearchEntity.updateOne(
    { _id: plan.entityId },
    { $set: { sourceUrls: plan.sourceUrlsAfter } },
  );
  if (plan.observationIds.length > 0) {
    await Observation.updateMany(
      { _id: { $in: plan.observationIds.map((id) => new mongoose.Types.ObjectId(id)) } },
      { $set: { superseded: true, rollback: { rolledBackAt: new Date(), reason: ROLLBACK_REASON } } },
    );
  }
  // materializeEntity only writes fields with a remaining resolvable
  // observation - a field whose only observation was just superseded above is
  // silently left at its stale (wrong-person) value, never cleared. Explicitly
  // unset any touched field that now has zero remaining non-superseded
  // observations so the entity fails closed to a missing-description state
  // rather than keep serving the fabricated content (#1191/#1192 pattern).
  const remaining = await Observation.find({
    entityType: 'researchEntity',
    $or: [{ entityId: new mongoose.Types.ObjectId(plan.entityId) }, { entityKey: plan.slug }],
    field: { $in: CLEARABLE_FIELDS },
    superseded: { $ne: true },
  })
    .select('field')
    .lean();
  const fieldsWithRemainingEvidence = new Set(remaining.map((observation) => observation.field));
  const currentDoc = await ResearchEntity.findById(plan.entityId).select(CLEARABLE_FIELDS.join(' ')).lean<Record<string, unknown>>();
  const unset: Record<string, ''> = {};
  for (const field of CLEARABLE_FIELDS) {
    if (!fieldsWithRemainingEvidence.has(field) && currentDoc && currentDoc[field] !== undefined) {
      unset[field] = '';
    }
  }
  if (Object.keys(unset).length > 0) {
    await ResearchEntity.updateOne({ _id: plan.entityId }, { $unset: unset });
  }
  await materializeEntity('researchEntity', { entityKey: plan.slug }, { dryRun: false });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const confirmed = argv.includes('--confirm-fix-1537-namesake-source-fusion');
  if (apply && !confirmed) {
    throw new Error('--confirm-fix-1537-namesake-source-fusion is required when --apply is set.');
  }
  const outputArg = argv.find((arg) => arg.startsWith('--output='));
  const output = outputArg ? resolveSafeJsonReportOutputPath(outputArg.split('=')[1]) : undefined;

  const guard = assertScriptApplyAllowed({ apply, scriptName: SCRIPT_NAME, mongoUrl: process.env.MONGODBURL });
  console.log(`Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`);

  await initializeConnections();
  try {
    const plans = await Promise.all(TARGET_SLUGS.map(planNamesakeFusionRepair));

    if (apply) {
      for (const plan of plans) await applyPlan(plan);
    }

    const changedEntityIds = plans.filter((plan) => plan.found).map((plan) => plan.entityId!);
    let meiliSynced = 0;
    let visibilityTierChanges = 0;
    if (apply && changedEntityIds.length > 0) {
      const gate = await runStudentVisibilityGate({
        collection: 'research',
        mode: 'apply',
        recordIds: changedEntityIds,
      });
      visibilityTierChanges = gate.counts.changed;
      const freshDocs = await ResearchEntity.find({ _id: { $in: changedEntityIds } }).lean();
      await syncEntities('researchEntity', freshDocs);
      meiliSynced = freshDocs.length;
    }

    const report = {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      mode: apply ? 'apply' : 'dry-run',
      entitiesTargeted: TARGET_SLUGS.length,
      entitiesFound: plans.filter((plan) => plan.found).length,
      entitiesChanged: plans.filter((plan) => plan.mismatchedSourceUrls.length > 0).length,
      visibilityTierChanges,
      meiliSynced,
      plans,
    };

    if (output) {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, JSON.stringify(report, null, 2));
      console.log(`Saved #1537 namesake source-fusion repair report to ${output}`);
    }
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}
