import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { LEAD_ROLE_CANONICAL_VALUES } from '../models/canonicalRoleMapping';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { Researcher } from '../models/researcher';
import { RoleAssignment } from '../models/roleAssignment';
import {
  applyStudentVisibilityGatePlans,
  isStudentVisibilityGatePlanMateriallyChanged,
  planStudentVisibilityGate,
} from '../services/studentVisibilityGateService';
import { syncEntity } from '../services/meiliSyncService';
import { resolveResearchEntityCanonicalByTombstone } from '../services/researchEntityCanonicalTombstone';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  fieldValueRefusalKey,
  planFieldValueRefusal,
} from '../utils/researchEntityFieldValueRefusals';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  PERSON_DIRECTORY_WEBSITE_LANES,
  planBorrowedLabWebsiteRetirement,
  type DirectoryWebsiteClaim,
  type LabWebsiteRow,
} from './retireBorrowedLabWebsitesCore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const SCRIPT_NAME = 'observations:retire-borrowed-lab-websites';
export const CONFIRM_FLAG = '--confirm-retire-borrowed-lab-websites';
const ROLLBACK_REASON =
  "a person-directory lane gave this row a lab page that is another lead's research website, which the lane withdraws once the value is refused (#4980)";
const REFUSAL_NOTE =
  "this lab page is another row's research website, led by people this row does not share, so a profile linking it names the lab this person works in rather than their own (#4980).";

export function parseRetireBorrowedLabWebsitesArgs(argv: string[]): {
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

type RowDoc = Record<string, unknown> & { _id: mongoose.Types.ObjectId };

async function leadsByEntityId(
  entityIds: mongoose.Types.ObjectId[],
): Promise<Map<string, { personIds: string[]; names: string[] }>> {
  const edges = (await RoleAssignment.find({
    'target.kind': 'RESEARCH_ENTITY',
    'target.id': { $in: entityIds },
    archived: { $ne: true },
    state: { $ne: 'HISTORICAL' },
    role: { $in: [...LEAD_ROLE_CANONICAL_VALUES] },
  })
    .select('target.id personId')
    .lean()) as unknown as Array<{ target: { id: unknown }; personId: unknown }>;
  const personIds = [...new Set(edges.map((edge) => String(edge.personId)))];
  const people = (await Researcher.find({ _id: { $in: personIds } })
    .select('_id displayName')
    .lean()) as unknown as Array<{ _id: unknown; displayName?: unknown }>;
  const nameById = new Map(people.map((person) => [String(person._id), text(person.displayName)]));
  const leads = new Map<string, { personIds: string[]; names: string[] }>();
  for (const edge of edges) {
    const entityId = String(edge.target.id);
    const personId = String(edge.personId);
    const entry = leads.get(entityId) ?? { personIds: [], names: [] };
    if (!entry.personIds.includes(personId)) {
      entry.personIds.push(personId);
      const name = nameById.get(personId);
      if (name) entry.names.push(name);
    }
    leads.set(entityId, entry);
  }
  return leads;
}

/**
 * The live row each observed key lands on. A lane keeps observing a row under the slug
 * it minted, so a row merged into another is still claimed under the archived slug, and
 * the claim belongs to the survivor the tombstone chain resolves to.
 */
async function liveSlugsForObservedKeys(observedKeys: string[]): Promise<Map<string, string>> {
  const docs = (await ResearchEntity.find({ slug: { $in: observedKeys } })
    .select('_id slug archived canonicalGroupId')
    .lean()) as unknown as Array<RowDoc>;
  const liveSlugByObservedKey = new Map<string, string>();
  for (const doc of docs) {
    const observedKey = text(doc.slug);
    if (doc.archived !== true) {
      liveSlugByObservedKey.set(observedKey, observedKey);
      continue;
    }
    const survivor = (await resolveResearchEntityCanonicalByTombstone(doc as never)) as
      (Record<string, unknown> & { archived?: unknown }) | null;
    if (survivor && survivor.archived !== true && text(survivor.slug)) {
      liveSlugByObservedKey.set(observedKey, text(survivor.slug));
    }
  }
  return liveSlugByObservedKey;
}

async function loadInputs() {
  const claimDocs = (await Observation.find({
    entityType: 'researchEntity',
    sourceName: { $in: [...PERSON_DIRECTORY_WEBSITE_LANES] },
    field: 'websiteUrl',
    superseded: { $ne: true },
  })
    .select('_id entityKey sourceName value')
    .lean()) as unknown as Array<Record<string, unknown>>;
  const observedKeys = [...new Set(claimDocs.map((doc) => text(doc.entityKey)).filter(Boolean))];
  const liveSlugByObservedKey = await liveSlugsForObservedKeys(observedKeys);
  const claims: DirectoryWebsiteClaim[] = claimDocs.flatMap((doc) => {
    const liveSlug = liveSlugByObservedKey.get(text(doc.entityKey));
    return liveSlug
      ? [
          {
            observationId: String(doc._id),
            entityKey: liveSlug,
            sourceName: text(doc.sourceName),
            value: doc.value,
          },
        ]
      : [];
  });
  const claimedKeys = new Set(
    claims.map((claim) => fieldValueRefusalKey('websiteUrl', claim.value)),
  );
  const slugs = [...new Set(claims.map((claim) => claim.entityKey))];

  const select =
    '_id slug websiteUrl fieldProvenance.websiteUrl.sourceName fieldValueRefusals manuallyLockedFields studentVisibilityTier';
  const claimantDocs = (await ResearchEntity.find({ slug: { $in: slugs }, archived: { $ne: true } })
    .select(select)
    .lean()) as unknown as RowDoc[];
  const ownerDocs = (
    (await ResearchEntity.find({ archived: { $ne: true }, websiteUrl: { $nin: [null, ''] } })
      .select(select)
      .lean()) as unknown as RowDoc[]
  ).filter((doc) => claimedKeys.has(fieldValueRefusalKey('websiteUrl', doc.websiteUrl)));

  const docsById = new Map([...claimantDocs, ...ownerDocs].map((doc) => [String(doc._id), doc]));
  const leads = await leadsByEntityId([...docsById.values()].map((doc) => doc._id));
  const toRow = (doc: RowDoc): LabWebsiteRow & { tier: string } => {
    const provenance = (doc.fieldProvenance as { websiteUrl?: { sourceName?: unknown } })
      ?.websiteUrl;
    const rowLeads = leads.get(String(doc._id));
    return {
      entityId: String(doc._id),
      slug: text(doc.slug),
      websiteUrl: doc.websiteUrl,
      websiteUrlSourceName: text(provenance?.sourceName),
      leadPersonIds: rowLeads?.personIds ?? [],
      leadNames: rowLeads?.names ?? [],
      fieldValueRefusals: doc.fieldValueRefusals,
      manuallyLockedFields: doc.manuallyLockedFields,
      tier: text(doc.studentVisibilityTier),
    };
  };

  const rowsBySlug = new Map(claimantDocs.map((doc) => [text(doc.slug), toRow(doc)]));
  const ownersByUrlKey = new Map<string, LabWebsiteRow[]>();
  for (const doc of ownerDocs) {
    const key = fieldValueRefusalKey('websiteUrl', doc.websiteUrl);
    ownersByUrlKey.set(key, [...(ownersByUrlKey.get(key) ?? []), toRow(doc)]);
  }

  const otherDocs = (await Observation.find({
    entityType: 'researchEntity',
    entityKey: { $in: [...liveSlugByObservedKey.keys()] },
    field: { $in: ['websiteUrl', 'website'] },
    sourceName: { $nin: [...PERSON_DIRECTORY_WEBSITE_LANES] },
    superseded: { $ne: true },
  })
    .select('entityKey value')
    .lean()) as unknown as Array<Record<string, unknown>>;
  const otherLaneSupport = new Set(
    otherDocs.map(
      (doc) =>
        `${liveSlugByObservedKey.get(text(doc.entityKey))}|${fieldValueRefusalKey('websiteUrl', doc.value)}`,
    ),
  );
  return { claims, rowsBySlug, ownersByUrlKey, otherLaneSupport };
}

async function main(): Promise<void> {
  const options = parseRetireBorrowedLabWebsitesArgs(process.argv.slice(2));
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
  const outcome = planBorrowedLabWebsiteRetirement(inputs);
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
      // Read fresh, because one row can carry two borrowed pages and the second refusal
      // must extend the list the first one wrote rather than the list loaded before either.
      const fresh = (await ResearchEntity.findById(plan.entityId)
        .select('fieldValueRefusals')
        .lean()) as { fieldValueRefusals?: unknown } | null;
      const update: Record<string, unknown> = {};
      if (plan.refuse) {
        update.$set = planFieldValueRefusal(fresh?.fieldValueRefusals, {
          field: 'websiteUrl',
          value: plan.url,
          rule: 'wrong_owner',
          sourceName: plan.sourceName,
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
    plannedRows: plans.length,
    plannedServedClears: plans.filter((plan) => plan.clearStored).length,
    plannedStudentReadyClears: plans.filter(
      (plan) => plan.clearStored && tierOf(plan.slug) === 'student_ready',
    ).length,
    plannedRefusals: plans.filter((plan) => plan.refuse).length,
    plannedBySourceName: plans.reduce<Record<string, number>>((counts, plan) => {
      counts[plan.sourceName] = (counts[plan.sourceName] ?? 0) + 1;
      return counts;
    }, {}),
    keptAsCoLeadTwin: outcome.keptAsCoLeadTwin,
    keptAsNamedForClaimant: outcome.keptAsNamedForClaimant,
    keptByOtherEvidence: outcome.keptByOtherEvidence,
    keptWithoutAuthoritativeOwner: outcome.keptWithoutAuthoritativeOwner,
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
    fs.writeFileSync(
      options.output,
      `${JSON.stringify({ ...report, plans: plans.map(({ slug, url, ownerSlug, sourceName }) => ({ slug, url, ownerSlug, sourceName })) }, null, 2)}\n`,
    );
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
