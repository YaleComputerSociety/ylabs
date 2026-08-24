/**
 * Fix for #1671: clears the confirmed cross-domain namesake grafts where a
 * non-medical entity's `fullDescription`/`shortDescription`/`researchAreas`
 * were scraped from a different, same-name person's `medicine.yale.edu`
 * profile. Manual verification of the full 32-row detector cohort (student_ready,
 * `fieldProvenance.fullDescription.sourceUrl` matching `medicine.yale.edu`, entity
 * `school` != "School of Medicine") found exactly these 4 unambiguous wrong-person
 * grafts; the remaining rows are legitimate cross-appointed or history-of-science
 * faculty correctly sourced from their own medicine.yale.edu page and are left
 * untouched. Superseding the backing observations (not just clearing the document
 * fields) keeps the graft from resurfacing on the next materialize pass.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { syncEntities } from '../services/meiliSyncService';
import {
  planStudentVisibilityGate,
  applyStudentVisibilityGatePlans,
  type StudentVisibilityGatePlan,
} from '../services/studentVisibilityGateService';
import { serializedDocumentId } from '../utils/idSerialization';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'research-entity:fix-1671-medicine-namesake-graft';
const ROLLBACK_REASON =
  'cross-domain namesake graft: description/areas sourced from a different, same-name person on medicine.yale.edu (#1671)';
const GRAFTED_FIELDS = ['fullDescription', 'shortDescription', 'researchAreas'] as const;
const MEDICINE_SOURCE_URL_RE = /medicine\.yale\.edu/i;

const AFFECTED_SLUGS = ['crewdson-lab-gc58', 'gage-mfg6', 'deamer-md33', 'robinson-40tim'];

const apply = process.argv.includes('--apply');
const confirmed = process.argv.includes('--confirm-fix-1671');

interface EntityPlan {
  slug: string;
  found: boolean;
  entityId?: string;
  observationIdsToSupersede: string[];
  fieldsCleared: string[];
  sourceUrlsRemoved: string[];
  websiteUrlCleared: boolean;
}

async function planForEntity(slug: string): Promise<EntityPlan> {
  const entity = await ResearchEntity.findOne({ slug })
    .select('_id slug websiteUrl sourceUrls fullDescription shortDescription researchAreas')
    .lean<Record<string, unknown> & { _id: mongoose.Types.ObjectId }>();
  if (!entity) return { slug, found: false, observationIdsToSupersede: [], fieldsCleared: [], sourceUrlsRemoved: [], websiteUrlCleared: false };

  const activeObservations = await Observation.find({
    entityType: 'researchEntity',
    $or: [{ entityId: entity._id }, { entityKey: slug }],
    field: { $in: GRAFTED_FIELDS },
    superseded: { $ne: true },
  })
    .select('_id field sourceUrl')
    .lean();

  const graftedObservations = activeObservations.filter((observation: any) =>
    MEDICINE_SOURCE_URL_RE.test(observation.sourceUrl || ''),
  );
  const graftedFieldSet = new Set(graftedObservations.map((observation: any) => observation.field));
  const anyActiveFieldSet = new Set(activeObservations.map((observation: any) => observation.field));
  const otherActiveFieldSet = new Set(
    activeObservations
      .filter((observation: any) => !MEDICINE_SOURCE_URL_RE.test(observation.sourceUrl || ''))
      .map((observation: any) => observation.field),
  );
  const hasCurrentValue = (field: (typeof GRAFTED_FIELDS)[number]): boolean => {
    const value = (entity as Record<string, unknown>)[field];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  };
  // Clear a field when every one of its active observations is the graft
  // (never when an independent, non-medicine.yale.edu observation also backs
  // it), or when the currently-served value has NO backing observation at all -
  // a document-only residue of the same graft (e.g. `researchAreas` written by
  // an older pipeline stage that never recorded an observation) - so this can
  // never clobber a field genuinely backed by other evidence.
  const fieldsCleared = GRAFTED_FIELDS.filter(
    (field) =>
      (graftedFieldSet.has(field) && !otherActiveFieldSet.has(field)) ||
      (!anyActiveFieldSet.has(field) && hasCurrentValue(field)),
  );

  const sourceUrls = Array.isArray(entity.sourceUrls) ? (entity.sourceUrls as string[]) : [];
  const sourceUrlsRemoved = sourceUrls.filter((url) => MEDICINE_SOURCE_URL_RE.test(url));
  const websiteUrlCleared =
    typeof entity.websiteUrl === 'string' && MEDICINE_SOURCE_URL_RE.test(entity.websiteUrl);

  return {
    slug,
    found: true,
    entityId: String(entity._id),
    observationIdsToSupersede: graftedObservations.map((observation: any) => serializedDocumentId(observation._id) || String(observation._id)),
    fieldsCleared,
    sourceUrlsRemoved,
    websiteUrlCleared,
  };
}

async function applyPlan(plan: EntityPlan): Promise<void> {
  if (!plan.found || !plan.entityId) return;

  if (plan.observationIdsToSupersede.length > 0) {
    await Observation.updateMany(
      { _id: { $in: plan.observationIdsToSupersede.map((id) => new mongoose.Types.ObjectId(id)) } },
      { $set: { superseded: true, rollback: { rolledBackAt: new Date(), reason: ROLLBACK_REASON } } },
    );
  }

  const set: Record<string, unknown> = {};
  const unset: Record<string, unknown> = {};
  for (const field of plan.fieldsCleared) {
    set[field] = field === 'researchAreas' ? [] : '';
    unset[`fieldProvenance.${field}`] = '';
  }
  if (plan.sourceUrlsRemoved.length > 0) {
    const entity = await ResearchEntity.findById(plan.entityId).select('sourceUrls').lean<{ sourceUrls?: string[] }>();
    const remaining = (entity?.sourceUrls || []).filter((url) => !MEDICINE_SOURCE_URL_RE.test(url));
    set.sourceUrls = remaining;
  }
  if (plan.websiteUrlCleared) set.websiteUrl = '';

  const update: Record<string, unknown> = {};
  if (Object.keys(set).length > 0) update.$set = set;
  if (Object.keys(unset).length > 0) update.$unset = unset;
  if (Object.keys(update).length > 0) {
    await ResearchEntity.updateOne({ _id: plan.entityId }, update);
  }
}

function logGatePlanChange(plan: StudentVisibilityGatePlan): void {
  console.log(`  ${plan.label}: ${plan.currentTier ?? 'unset'} -> ${plan.tier} [${plan.reasons.join(', ')}]`);
}

async function main(): Promise<void> {
  if (apply && !confirmed) {
    throw new Error(`--confirm-fix-1671 is required when --apply is set for ${SCRIPT_NAME}`);
  }
  const guard = assertScriptApplyAllowed({ apply, scriptName: SCRIPT_NAME, mongoUrl: process.env.MONGODBURL });
  await initializeConnections();

  const plans = await Promise.all(AFFECTED_SLUGS.map(planForEntity));
  console.log(JSON.stringify({ environment: guard.environment, db: guard.dbLabel, mode: apply ? 'apply' : 'dry-run', plans }, null, 2));

  const recordIds = plans.filter((plan) => plan.found && plan.entityId).map((plan) => plan.entityId as string);
  if (recordIds.length === 0) {
    console.error('No target entities found; nothing to do.');
    return;
  }

  if (!apply) {
    const gatePlans = await planStudentVisibilityGate({ collection: 'research', mode: 'dry-run', recordIds });
    console.error('Dry run: student visibility gate impact if applied (based on CURRENT field values, before clearing):');
    gatePlans.forEach(logGatePlanChange);
    return;
  }

  for (const plan of plans) await applyPlan(plan);
  console.error(`Cleared graft fields and superseded observations for ${recordIds.length} entities`);

  const gatePlans = await planStudentVisibilityGate({ collection: 'research', mode: 'dry-run', recordIds });
  gatePlans.forEach(logGatePlanChange);
  await applyStudentVisibilityGatePlans(gatePlans);
  console.error(`Applied gate updates to ${gatePlans.length} entities`);

  const fresh = await ResearchEntity.find({
    _id: { $in: recordIds.map((id) => new mongoose.Types.ObjectId(id)) },
  }).lean();
  await syncEntities('researchEntity', fresh as any);
  console.error(`Re-synced ${fresh.length} entities to Meili`);
}

main()
  .catch((error) => {
    console.error('fix1671MedicineNamesakeGraft failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
