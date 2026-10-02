import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import {
  applyStudentVisibilityGatePlans,
  isStudentVisibilityGatePlanMateriallyChanged,
  planStudentVisibilityGate,
} from '../services/studentVisibilityGateService';
import { syncEntity } from '../services/meiliSyncService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  fieldValueRefusalKey,
  planFieldValueRefusal,
} from '../utils/researchEntityFieldValueRefusals';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  planSharedRosterWebsiteRetirement,
  SHARED_ROSTER_WEBSITE_LANE,
  type LaneWebsiteClaim,
  type SharedWebsiteRow,
} from './retireSharedRosterWebsitesCore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const SCRIPT_NAME = 'observations:retire-shared-roster-websites';
export const CONFIRM_FLAG = '--confirm-retire-shared-roster-websites';
const ROLLBACK_REASON =
  'a website the roster lists for two or more different people is a group site, not this row own research website, which the lane itself now refuses (#3614, #3615)';
const REFUSAL_NOTE =
  'the department roster lists this website for two or more different people, so it is a group site rather than this row own research website, and no other lane asserts it for this row (#3615).';

export function parseRetireSharedRosterWebsitesArgs(argv: string[]): {
  dryRun: boolean;
  confirmed: boolean;
  output?: string;
} {
  const options: { dryRun: boolean; confirmed: boolean; output?: string } = {
    dryRun: true,
    confirmed: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.dryRun = false;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === CONFIRM_FLAG) options.confirmed = true;
    else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  return options;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

async function loadInputs() {
  const liveLane = {
    entityType: 'researchEntity' as const,
    sourceName: SHARED_ROSTER_WEBSITE_LANE,
    superseded: { $ne: true },
  };
  const claimDocs = (await Observation.find({ ...liveLane, field: 'websiteUrl' })
    .select('_id entityKey value observedAt')
    .lean()) as unknown as Array<Record<string, unknown>>;
  const claims: LaneWebsiteClaim[] = claimDocs
    .filter((doc) => text(doc.entityKey))
    .map((doc) => ({
      observationId: String(doc._id),
      entityKey: text(doc.entityKey),
      value: doc.value,
      observedAt: new Date(doc.observedAt as string),
    }));
  const slugs = [...new Set(claims.map((claim) => claim.entityKey))];

  const personDocs = (await Observation.find({
    ...liveLane,
    field: 'inferredPiUserKey',
    entityKey: { $in: slugs },
  })
    .select('entityKey value observedAt')
    .sort({ observedAt: -1 })
    .lean()) as unknown as Array<Record<string, unknown>>;
  const personKeyByEntityKey = new Map<string, string>();
  for (const doc of personDocs) {
    const slug = text(doc.entityKey);
    if (slug && !personKeyByEntityKey.has(slug)) personKeyByEntityKey.set(slug, text(doc.value));
  }

  const otherDocs = (await Observation.find({
    entityType: 'researchEntity',
    entityKey: { $in: slugs },
    field: { $in: ['websiteUrl', 'website'] },
    sourceName: { $ne: SHARED_ROSTER_WEBSITE_LANE },
    superseded: { $ne: true },
  })
    .select('entityKey value')
    .lean()) as unknown as Array<Record<string, unknown>>;
  const otherLaneSupport = new Set(
    otherDocs.map(
      (doc) => `${text(doc.entityKey)}|${fieldValueRefusalKey('websiteUrl', doc.value)}`,
    ),
  );

  const rowDocs = (await ResearchEntity.find({ slug: { $in: slugs }, archived: { $ne: true } })
    .select('_id slug websiteUrl fieldValueRefusals manuallyLockedFields studentVisibilityTier')
    .lean()) as unknown as Array<Record<string, unknown>>;
  const rowsBySlug = new Map<string, SharedWebsiteRow & { tier: string }>(
    rowDocs.map((doc) => [
      text(doc.slug),
      {
        entityId: String(doc._id),
        slug: text(doc.slug),
        websiteUrl: doc.websiteUrl,
        fieldValueRefusals: doc.fieldValueRefusals,
        manuallyLockedFields: doc.manuallyLockedFields,
        tier: text(doc.studentVisibilityTier),
      },
    ]),
  );
  return { claims, personKeyByEntityKey, otherLaneSupport, rowsBySlug };
}

async function main(): Promise<void> {
  const options = parseRetireSharedRosterWebsitesArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: !options.dryRun,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  if (!options.dryRun && !options.confirmed)
    throw new Error(`${SCRIPT_NAME} apply requires ${CONFIRM_FLAG}`);
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${options.dryRun ? 'dry-run' : 'apply'}`,
  );
  await initializeConnections();

  const inputs = await loadInputs();
  const outcome = planSharedRosterWebsiteRetirement(inputs);
  const plans = outcome.plans;
  const tierOf = (slug: string) => inputs.rowsBySlug.get(slug)?.tier ?? '';

  let observationsSuperseded = 0;
  let refusalsRecorded = 0;
  let storedCleared = 0;
  let regatedEntities = 0;
  let demotedFromStudentReady = 0;
  let indexSyncFailures = 0;
  if (!options.dryRun && plans.length > 0) {
    const ids = plans.flatMap((plan) => plan.supersedeObservationIds);
    const superseded = await Observation.updateMany(
      { _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) }, superseded: { $ne: true } },
      {
        $set: { superseded: true, rollback: { rolledBackAt: new Date(), reason: ROLLBACK_REASON } },
      },
    );
    observationsSuperseded = superseded.modifiedCount || 0;

    for (const plan of plans.filter((entry) => entry.refuse || entry.clearStored)) {
      // Read fresh, because one row can carry two shared URLs and the second refusal must
      // extend the list the first one wrote rather than the list loaded before either.
      const fresh = (await ResearchEntity.findById(plan.entityId)
        .select('fieldValueRefusals')
        .lean()) as { fieldValueRefusals?: unknown } | null;
      const update: Record<string, unknown> = {};
      if (plan.refuse) {
        update.$set = planFieldValueRefusal(fresh?.fieldValueRefusals, {
          field: 'websiteUrl',
          value: plan.url,
          rule: 'wrong_owner',
          sourceName: 'dept-faculty-roster',
          refusedBy: SCRIPT_NAME,
          note: REFUSAL_NOTE,
          evidenceUrl: plan.url,
        });
      }
      if (plan.clearStored) update.$unset = { websiteUrl: '', 'fieldProvenance.websiteUrl': '' };
      const result = await ResearchEntity.updateOne(
        { _id: new mongoose.Types.ObjectId(plan.entityId) },
        update,
      );
      if (result.modifiedCount > 0) {
        if (plan.refuse) refusalsRecorded += 1;
        if (plan.clearStored) storedCleared += 1;
      }
    }

    const recordIds = [...new Set(plans.map((plan) => plan.entityId))];
    const gatePlans = await planStudentVisibilityGate({
      collection: 'research',
      mode: 'apply',
      recordIds,
    });
    await applyStudentVisibilityGatePlans(gatePlans);
    regatedEntities = gatePlans.filter(isStudentVisibilityGatePlanMateriallyChanged).length;
    for (const entityId of recordIds) {
      const fresh = (await ResearchEntity.findById(entityId)
        .select('studentVisibilityTier slug')
        .lean()) as Record<string, unknown> | null;
      if (!fresh) continue;
      if (
        tierOf(text(fresh.slug)) === 'student_ready' &&
        text(fresh.studentVisibilityTier) !== 'student_ready'
      ) {
        demotedFromStudentReady += 1;
      }
      const full = await ResearchEntity.findById(entityId).lean();
      if (full && !(await syncEntity('researchEntity', full))) indexSyncFailures += 1;
    }
  }

  const report = {
    script: SCRIPT_NAME,
    mode: options.dryRun ? 'dry-run' : 'apply',
    sharedUrls: outcome.sharedUrls,
    plannedRows: plans.length,
    plannedServedClears: plans.filter((plan) => plan.clearStored).length,
    plannedStudentReadyClears: plans.filter(
      (plan) => plan.clearStored && tierOf(plan.slug) === 'student_ready',
    ).length,
    plannedRefusals: plans.filter((plan) => plan.refuse).length,
    keptByOtherEvidence: outcome.keptByOtherEvidence,
    plannedObservations: plans.reduce((sum, plan) => sum + plan.supersedeObservationIds.length, 0),
    observationsSuperseded: options.dryRun ? null : observationsSuperseded,
    refusalsRecorded: options.dryRun ? null : refusalsRecorded,
    storedCleared: options.dryRun ? null : storedCleared,
    regatedEntities: options.dryRun ? null : regatedEntities,
    demotedFromStudentReady: options.dryRun ? null : demotedFromStudentReady,
    indexSyncFailures: options.dryRun ? null : indexSyncFailures,
  };
  console.log(JSON.stringify(report, null, 2));
  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
  }
  await mongoose.disconnect();
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}
