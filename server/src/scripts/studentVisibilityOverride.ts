import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { AdminAuditEvent } from '../models/adminAuditEvent';
import { Fellowship } from '../models/fellowship';
import { ResearchEntity } from '../models/researchEntity';
import { holdingStudentVisibilityOverrideTiers } from '../models/studentVisibility';
import {
  assertScraperEnvironmentMatchesMongoTarget,
  resolveScraperEnvironment,
} from '../scrapers/scraperEnvironment';
import {
  countLiveFellowshipVisibilityOverrideObservations,
  readFellowship,
  retireFellowshipVisibilityOverrideObservations,
} from '../services/fellowshipService';
import { syncEntities } from '../services/meiliSyncService';
import { getResearchGroupDetail } from '../services/researchGroupService';
import { serializedDocumentId } from '../utils/idSerialization';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import {
  STUDENT_VISIBILITY_OVERRIDE_AUDIT,
  STUDENT_VISIBILITY_OVERRIDE_SCRIPT,
  parseStudentVisibilityOverrideArgs,
  planStudentVisibilityOverride,
  studentVisibilityOverrideWriteRefusal,
  overrideReviewerStamp,
  type StudentVisibilityOverrideArgs,
  type StudentVisibilityOverrideCollection,
} from './studentVisibilityOverrideCore';

dotenv.config({ quiet: true });
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const OVERRIDE_STATE_FIELDS =
  'archived studentVisibilityTier studentVisibilityOverrideTier studentVisibilitySuppressionReason';

interface OverrideCollectionAccess {
  model: mongoose.Model<any>;
  projection: string;
  label: (row: any) => string | undefined;
  searchIndexEntityType: string | null;
  servedNow: (row: any) => Promise<boolean>;
  backingObservations: {
    count: (row: any) => Promise<number>;
    retire: (row: any, reason: string) => Promise<number>;
  } | null;
}

const programIsServed = async (row: any): Promise<boolean> => {
  try {
    return Boolean(await readFellowship(row._id));
  } catch {
    return false;
  }
};

const OVERRIDE_COLLECTION_ACCESS: Record<
  StudentVisibilityOverrideCollection,
  OverrideCollectionAccess
> = {
  research: {
    model: ResearchEntity,
    projection: `_id slug name manuallyLockedFields ${OVERRIDE_STATE_FIELDS}`,
    label: (row) => row.slug,
    searchIndexEntityType: 'researchEntity',
    servedNow: async (row) => Boolean(await getResearchGroupDetail(row.slug)),
    backingObservations: null,
  },
  programs: {
    model: Fellowship,
    projection: `_id title sourceKey ${OVERRIDE_STATE_FIELDS}`,
    label: (row) => row.title,
    searchIndexEntityType: null,
    servedNow: programIsServed,
    backingObservations: {
      count: countLiveFellowshipVisibilityOverrideObservations,
      retire: retireFellowshipVisibilityOverrideObservations,
    },
  },
};

export function assertStudentVisibilityOverrideAllowed(
  args: StudentVisibilityOverrideArgs,
  env: NodeJS.ProcessEnv = process.env,
) {
  const environment = resolveScraperEnvironment(env);
  assertScraperEnvironmentMatchesMongoTarget({ environment, env });
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: STUDENT_VISIBILITY_OVERRIDE_SCRIPT,
    env,
  });
  const refusal = studentVisibilityOverrideWriteRefusal({ apply: args.apply, environment, env });
  if (refusal) throw new Error(refusal);
  return guard;
}

export async function runStudentVisibilityOverride(
  args: StudentVisibilityOverrideArgs,
  env: NodeJS.ProcessEnv = process.env,
) {
  const guard = assertStudentVisibilityOverrideAllowed(args, env);
  const access = OVERRIDE_COLLECTION_ACCESS[args.collection];
  const audit = STUDENT_VISIBILITY_OVERRIDE_AUDIT[args.collection];

  const filter = 'slug' in args.target ? { slug: args.target.slug } : { _id: args.target.id };
  const entity = (await access.model.findOne(filter).select(access.projection).lean()) as any;
  if (!entity) {
    return {
      script: STUDENT_VISIBILITY_OVERRIDE_SCRIPT,
      environment: guard.environment,
      db: guard.dbLabel,
      mode: args.apply ? 'apply' : 'dry-run',
      collection: args.collection,
      target: args.target,
      outcome: 'not_found' as const,
    };
  }
  if (entity.archived === true) throw new Error('Refusing to override an archived row');

  const entityId = serializedDocumentId(entity._id);
  const decision = planStudentVisibilityOverride(entity, args.action, args.reason);
  let audited = false;
  let searchIndexSynced: boolean | null = null;
  const retiresBackingObservations =
    decision.action === 'write' && args.action.kind === 'clear' && access.backingObservations;
  let backingObservationsRetired: number | null = retiresBackingObservations
    ? await access.backingObservations!.count(entity)
    : null;
  if (args.apply && decision.action === 'write') {
    const update: Record<string, unknown> = {
      $set:
        args.action.kind === 'set'
          ? { ...decision.set, ...overrideReviewerStamp(args.actorNetid, new Date()) }
          : decision.set,
    };
    if (Object.keys(decision.unset).length > 0) update.$unset = decision.unset;
    await access.model.updateOne({ _id: entity._id }, update);
    if (retiresBackingObservations) {
      backingObservationsRetired = await access.backingObservations!.retire(entity, args.reason);
    }
    if (access.searchIndexEntityType) {
      const written = await access.model.findById(entity._id).lean();
      searchIndexSynced =
        (await syncEntities(access.searchIndexEntityType, written ? [written] : [])) > 0;
    }
    await AdminAuditEvent.create({
      actorNetid: args.actorNetid,
      action: audit.actions[args.action.kind],
      targetType: audit.targetType,
      targetId: entityId,
      summary: {
        fields: Object.keys({ ...decision.set, ...decision.unset }),
        note: args.reason,
        status: args.action.kind,
      },
      metadata: {
        script: STUDENT_VISIBILITY_OVERRIDE_SCRIPT,
        collection: args.collection,
        label: access.label(entity),
        environment: guard.environment,
        backingObservationsRetired,
        before: decision.before,
        after: decision.after,
      },
      timestamp: new Date(),
    });
    audited = true;
  }

  const regate = `student-visibility:gate --apply --confirm-student-visibility-apply --collection=${args.collection} --record-id=${entityId}`;
  return {
    script: STUDENT_VISIBILITY_OVERRIDE_SCRIPT,
    environment: guard.environment,
    db: guard.dbLabel,
    mode: args.apply ? 'apply' : 'dry-run',
    collection: args.collection,
    target: { label: access.label(entity), id: entityId },
    action: args.action,
    reason: args.reason,
    decision,
    audited,
    searchIndexSynced,
    backingObservationsRetired,
    servedNow: await access.servedNow(entity),
    next:
      args.action.kind === 'set' && holdingStudentVisibilityOverrideTiers.includes(args.action.tier)
        ? `The hold is the stored tier now and every serve path reads it; run ${regate} to refresh the reasons.`
        : `A release or a clear changes the served tier only when the gate re-decides the row: run ${regate}.`,
  };
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const args = parseStudentVisibilityOverrideArgs(argv);
  assertStudentVisibilityOverrideAllowed(args);
  await initializeConnections();
  try {
    console.log(JSON.stringify(await runStudentVisibilityOverride(args), null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
