import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { Researcher } from '../models/researcher';
import { RoleAssignment } from '../models/roleAssignment';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { serializedDocumentId } from '../utils/idSerialization';
import {
  applyStudentVisibilityGatePlans,
  planStudentVisibilityGate,
} from '../services/studentVisibilityGateService';
import {
  comparableName,
  leadWouldUnblock,
  planFraLeadAttachment,
  type FraLeadResearcher,
} from './attachFraNamedLeadsCore';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'research-entity:attach-fra-named-leads';

interface Args {
  apply: boolean;
  confirm: boolean;
  maxApply: number;
  output?: string;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, confirm: false, maxApply: 200 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--dry-run') args.apply = false;
    else if (arg === '--confirm-attach-fra-leads') args.confirm = true;
    else if (arg === '--max-apply') args.maxApply = Number(argv[++index]);
    else if (arg.startsWith('--max-apply='))
      args.maxApply = Number(arg.slice('--max-apply='.length));
    else if (arg === '--output') args.output = argv[++index];
    else if (arg.startsWith('--output=')) args.output = arg.slice('--output='.length);
    else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  if (!Number.isSafeInteger(args.maxApply) || args.maxApply < 1) {
    throw new Error('--max-apply must be a safe positive integer');
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const researchers = await Researcher.find({ archived: { $ne: true } })
    .select('_id displayName')
    .lean();
  const byName = new Map<string, Array<FraLeadResearcher & { _id: unknown }>>();
  for (const researcher of researchers as any[]) {
    const key = comparableName(researcher.displayName);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(researcher);
  }

  const entities = await ResearchEntity.find({
    archived: { $ne: true },
    studentVisibilityTier: { $ne: 'student_ready' },
    studentVisibilityReasons: 'missing_lead',
  })
    .select('_id slug name entityType sourceUrls studentVisibilityReasons studentVisibilityTier')
    .lean();

  const planned: Array<{
    entityId: string;
    personId: string;
    entityType?: string;
    unblocks: boolean;
  }> = [];
  let nameOnlyRefused = 0;

  for (const entity of entities as any[]) {
    const plan = planFraLeadAttachment(entity, byName);
    if (!plan) {
      nameOnlyRefused += 1;
      continue;
    }
    const match = byName.get(comparableName(plan.personName))?.[0];
    const entityId = serializedDocumentId(entity._id);
    const personId = serializedDocumentId((match as any)?._id);
    if (!entityId || !personId) continue;
    const existing = await RoleAssignment.countDocuments({
      'target.kind': 'RESEARCH_ENTITY',
      'target.id': new mongoose.Types.ObjectId(entityId),
      archived: { $ne: true },
    });
    if (existing > 0) continue;
    planned.push({
      entityId,
      personId,
      entityType: entity.entityType,
      unblocks: leadWouldUnblock(entity),
    });
  }

  const unblocking = planned.filter((row) => row.unblocks);

  if (args.apply) {
    if (!args.confirm)
      throw new Error('--confirm-attach-fra-leads is required when --apply is set.');
    if (planned.length > args.maxApply) {
      throw new Error(
        `Apply would attach ${planned.length} leads, above --max-apply=${args.maxApply}.`,
      );
    }
  }

  let attached = 0;
  let promoted = 0;
  if (args.apply && planned.length > 0) {
    for (const row of planned) {
      await RoleAssignment.create({
        personId: new mongoose.Types.ObjectId(row.personId),
        target: { kind: 'RESEARCH_ENTITY', id: new mongoose.Types.ObjectId(row.entityId) },
        role: 'PI',
        state: 'CURRENT',
        confidence: 0.9,
        reviewStatus: 'UNREVIEWED',
      });
      attached += 1;
    }
    const plans = await planStudentVisibilityGate({
      collection: 'research',
      mode: 'apply',
      recordIds: planned.map((row) => row.entityId),
    });
    await applyStudentVisibilityGatePlans(plans);
    // A written assignment is not a promoted row (#2440), so the promotion is counted
    // by re-reading the tier rather than by counting the writes.
    promoted = await ResearchEntity.countDocuments({
      _id: { $in: planned.map((row) => new mongoose.Types.ObjectId(row.entityId)) },
      studentVisibilityTier: 'student_ready',
      archived: { $ne: true },
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    mode: args.apply ? 'apply' : 'dry-run',
    leadBlockedExamined: entities.length,
    refusedForWeakEvidence: nameOnlyRefused,
    plannedAttachments: planned.length,
    plannedAttachmentsThatUnblock: unblocking.length,
    attached,
    promotedToStudentReady: promoted,
    byEntityType: planned.reduce<Record<string, number>>((acc, row) => {
      const key = row.entityType || 'UNKNOWN';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
  };

  if (args.output) {
    const safeOutput = resolveSafeJsonReportOutputPath(args.output);
    fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
    fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify(report, null, 2));
  await mongoose.disconnect();
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
