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
import { comparableName } from './attachFraNamedLeadsCore';
import { buildExistingNameTokens, planResearcherMint } from './mintFraNamedResearchersCore';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'research-entity:mint-fra-named-researchers';

interface Args {
  apply: boolean;
  confirm: boolean;
  maxApply: number;
  output?: string;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, confirm: false, maxApply: 250 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--dry-run') args.apply = false;
    else if (arg === '--confirm-mint-fra-researchers') args.confirm = true;
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
    .select('displayName')
    .lean();
  const displayNames = (researchers as any[]).map((r) => r.displayName);
  const existingExactNames = new Set(displayNames.map((name) => comparableName(name)));
  const existingTokens = buildExistingNameTokens(displayNames);

  const entities = await ResearchEntity.find({
    archived: { $ne: true },
    studentVisibilityReasons: 'missing_lead',
  })
    .select('_id slug name entityType sourceUrls studentVisibilityReasons')
    .lean();

  const planned: Array<{
    entityId: string;
    personName: string;
    profileUrl: string;
    entityType?: string;
  }> = [];
  for (const entity of entities as any[]) {
    const plan = planResearcherMint(entity, existingExactNames, existingTokens);
    if (!plan) continue;
    const entityId = serializedDocumentId(entity._id);
    if (!entityId) continue;
    const existingRole = await RoleAssignment.countDocuments({
      'target.kind': 'RESEARCH_ENTITY',
      'target.id': new mongoose.Types.ObjectId(entityId),
      archived: { $ne: true },
    });
    if (existingRole > 0) continue;
    planned.push({
      entityId,
      personName: plan.personName,
      profileUrl: plan.profileUrl,
      entityType: entity.entityType,
    });
  }

  if (args.apply) {
    if (!args.confirm)
      throw new Error('--confirm-mint-fra-researchers is required when --apply is set.');
    if (planned.length > args.maxApply) {
      throw new Error(
        `Apply would mint ${planned.length} researchers, above --max-apply=${args.maxApply}.`,
      );
    }
  }

  let minted = 0;
  let attached = 0;
  let promoted = 0;
  if (args.apply && planned.length > 0) {
    const now = new Date();
    for (const row of planned) {
      const researcher = await Researcher.create({
        displayName: row.personName,
        status: 'UNKNOWN',
        profileLinks: [
          {
            kind: 'YALE_OFFICIAL',
            purpose: 'PRIMARY_IDENTITY',
            url: row.profileUrl,
            verifiedAt: now,
            healthStatus: 'UNKNOWN',
          },
        ],
      });
      minted += 1;
      await RoleAssignment.create({
        personId: researcher._id,
        target: { kind: 'RESEARCH_ENTITY', id: new mongoose.Types.ObjectId(row.entityId) },
        role: 'PI',
        state: 'CURRENT',
        confidence: 0.85,
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
    // Re-read the tier: a mint and an attachment are not a promotion (#2440).
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
    existingResearchers: displayNames.length,
    plannedMints: planned.length,
    minted,
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
