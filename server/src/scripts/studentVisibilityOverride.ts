import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { AdminAuditEvent } from '../models/adminAuditEvent';
import { ResearchEntity } from '../models/researchEntity';
import { holdingStudentVisibilityOverrideTiers } from '../models/studentVisibility';
import {
  assertScraperEnvironmentMatchesMongoTarget,
  resolveScraperEnvironment,
} from '../scrapers/scraperEnvironment';
import { syncEntities } from '../services/meiliSyncService';
import { getResearchGroupDetail } from '../services/researchGroupService';
import { serializedDocumentId } from '../utils/idSerialization';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import {
  STUDENT_VISIBILITY_OVERRIDE_AUDIT_ACTIONS,
  STUDENT_VISIBILITY_OVERRIDE_AUDIT_TARGET_TYPE,
  STUDENT_VISIBILITY_OVERRIDE_SCRIPT,
  parseStudentVisibilityOverrideArgs,
  planStudentVisibilityOverride,
  studentVisibilityOverrideWriteRefusal,
  type StudentVisibilityOverrideArgs,
} from './studentVisibilityOverrideCore';

dotenv.config({ quiet: true });
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const OVERRIDE_PROJECTION =
  '_id slug name archived studentVisibilityTier studentVisibilityOverrideTier studentVisibilitySuppressionReason manuallyLockedFields';

export async function runStudentVisibilityOverride(
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

  const filter = 'slug' in args.target ? { slug: args.target.slug } : { _id: args.target.id };
  const entity = (await ResearchEntity.findOne(filter).select(OVERRIDE_PROJECTION).lean()) as any;
  if (!entity) {
    return {
      script: STUDENT_VISIBILITY_OVERRIDE_SCRIPT,
      environment: guard.environment,
      db: guard.dbLabel,
      mode: args.apply ? 'apply' : 'dry-run',
      target: args.target,
      outcome: 'not_found' as const,
    };
  }
  if (entity.archived === true) throw new Error('Refusing to override an archived row');

  const entityId = serializedDocumentId(entity._id);
  const decision = planStudentVisibilityOverride(entity, args.action, args.reason);
  let audited = false;
  let searchIndexSynced: boolean | null = null;
  if (args.apply && decision.action === 'write') {
    const update: Record<string, unknown> = { $set: decision.set };
    if (Object.keys(decision.unset).length > 0) update.$unset = decision.unset;
    await ResearchEntity.updateOne({ _id: entity._id }, update);
    const written = await ResearchEntity.findById(entity._id).lean();
    searchIndexSynced = (await syncEntities('researchEntity', written ? [written] : [])) > 0;
    await AdminAuditEvent.create({
      actorNetid: args.actorNetid,
      action: STUDENT_VISIBILITY_OVERRIDE_AUDIT_ACTIONS[args.action.kind],
      targetType: STUDENT_VISIBILITY_OVERRIDE_AUDIT_TARGET_TYPE,
      targetId: entityId,
      summary: {
        fields: Object.keys({ ...decision.set, ...decision.unset }),
        note: args.reason,
        status: args.action.kind,
      },
      metadata: {
        script: STUDENT_VISIBILITY_OVERRIDE_SCRIPT,
        slug: entity.slug,
        environment: guard.environment,
        before: decision.before,
        after: decision.after,
      },
      timestamp: new Date(),
    });
    audited = true;
  }

  return {
    script: STUDENT_VISIBILITY_OVERRIDE_SCRIPT,
    environment: guard.environment,
    db: guard.dbLabel,
    mode: args.apply ? 'apply' : 'dry-run',
    target: { slug: entity.slug, id: entityId },
    action: args.action,
    reason: args.reason,
    decision,
    audited,
    searchIndexSynced,
    servedNow: Boolean(await getResearchGroupDetail(entity.slug)),
    next:
      args.action.kind === 'set' && holdingStudentVisibilityOverrideTiers.includes(args.action.tier)
        ? 'The hold is the stored tier now and every serve path reads it; run student-visibility:gate --apply --confirm-student-visibility-apply --record-id=<id> to refresh the reasons.'
        : 'A release or a clear changes the served tier only when the gate re-decides the row: run student-visibility:gate --apply --confirm-student-visibility-apply --record-id=<id>.',
  };
}

async function main(): Promise<void> {
  const args = parseStudentVisibilityOverrideArgs(process.argv.slice(2));
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
