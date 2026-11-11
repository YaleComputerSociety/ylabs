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
import { loadDirectoryRemovalMintGuard } from '../services/directoryRemovalMintGuard';
import { serializedDocumentId } from '../utils/idSerialization';
import {
  applyStudentVisibilityGatePlans,
  planStudentVisibilityGate,
} from '../services/studentVisibilityGateService';
import { comparableName } from './attachFraNamedLeadsCore';
import { canonicalProfileKey, planResearcherMint } from './mintFraNamedResearchersCore';

dotenv.config({ quiet: true });
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const SCRIPT_NAME = 'research-entity:mint-fra-named-researchers';

export interface Args {
  apply: boolean;
  confirm: boolean;
  maxApply: number;
  output?: string;
  slugs: string[];
}

function splitSlugs(value: string | undefined): string[] {
  return String(value ?? '')
    .split(',')
    .map((slug) => slug.trim())
    .filter(Boolean);
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, confirm: false, maxApply: 250, slugs: [] };
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
    else if (arg === '--slug') args.slugs.push(...splitSlugs(argv[++index]));
    else if (arg.startsWith('--slug=')) args.slugs.push(...splitSlugs(arg.slice('--slug='.length)));
    else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  if (
    argv.some((arg) => arg === '--slug' || arg.startsWith('--slug=')) &&
    args.slugs.length === 0
  ) {
    throw new Error('--slug requires at least one research entity slug');
  }
  args.slugs = [...new Set(args.slugs)];
  if (!Number.isSafeInteger(args.maxApply) || args.maxApply < 1) {
    throw new Error('--max-apply must be a safe positive integer');
  }
  return args;
}

export async function runMintFraNamedResearchers(args: Args) {
  const removalGuard = await loadDirectoryRemovalMintGuard();

  const researchers = await Researcher.find({ archived: { $ne: true } })
    .select('displayName profileLinks')
    .lean();
  const displayNames = (researchers as any[]).map((r) => r.displayName);
  const existingExactNames = new Set(displayNames.map((name) => comparableName(name)));
  const claimedProfileKeys = new Set<string>();
  for (const researcher of researchers as any[]) {
    for (const link of researcher.profileLinks || []) {
      const key = canonicalProfileKey(link?.url);
      if (key) claimedProfileKeys.add(key);
    }
  }

  const scoped = args.slugs.length > 0;
  const entities = await ResearchEntity.find({
    archived: { $ne: true },
    studentVisibilityReasons: 'missing_lead',
    ...(scoped ? { slug: { $in: args.slugs } } : {}),
  })
    .select('_id slug name entityType sourceUrls studentVisibilityReasons')
    .lean();
  const scopeRefusals = new Map<string, string>();

  const planned: Array<{
    entityId: string;
    personName: string;
    profileUrl: string;
    entityType?: string;
    slug?: string;
  }> = [];
  for (const entity of entities as any[]) {
    const plan = planResearcherMint(entity, existingExactNames, claimedProfileKeys);
    if (!plan) {
      scopeRefusals.set(entity.slug, 'no named lead with an unclaimed cited Yale profile url');
      continue;
    }
    const entityId = serializedDocumentId(entity._id);
    if (!entityId) continue;
    const existingRole = await RoleAssignment.countDocuments({
      'target.kind': 'RESEARCH_ENTITY',
      'target.id': new mongoose.Types.ObjectId(entityId),
      archived: { $ne: true },
    });
    if (existingRole > 0) {
      scopeRefusals.set(entity.slug, 'already has a current role assignment');
      continue;
    }
    if (removalGuard.refusesPerson({ profileLinks: [{ url: plan.profileUrl }] })) {
      removalGuard.recordRefusal();
      scopeRefusals.set(entity.slug, 'refused as removed by request');
      continue;
    }
    planned.push({
      entityId,
      personName: plan.personName,
      profileUrl: plan.profileUrl,
      entityType: entity.entityType,
      slug: entity.slug,
    });
  }

  if (scoped) await assertEverySlugIsACandidate(args.slugs, planned, scopeRefusals);

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

  return {
    mode: args.apply ? 'apply' : 'dry-run',
    ...(scoped ? { scopedSlugs: args.slugs } : {}),
    leadBlockedExamined: entities.length,
    existingResearchers: displayNames.length,
    claimedProfileUrls: claimedProfileKeys.size,
    plannedMints: planned.length,
    refusedAsRemovedByRequest: removalGuard.refusals,
    minted,
    attached,
    promotedToStudentReady: promoted,
    byEntityType: planned.reduce<Record<string, number>>((acc, row) => {
      const key = row.entityType || 'UNKNOWN';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
  };
}

async function assertEverySlugIsACandidate(
  slugs: readonly string[],
  planned: ReadonlyArray<{ slug?: string }>,
  scopeRefusals: Map<string, string>,
): Promise<void> {
  const plannedSlugs = new Set(planned.map((row) => row.slug));
  const refusals: string[] = [];
  for (const slug of slugs) {
    if (plannedSlugs.has(slug)) continue;
    refusals.push(`${slug}: ${scopeRefusals.get(slug) ?? (await nonCandidateReason(slug))}`);
  }
  if (refusals.length > 0) {
    throw new Error(
      `${SCRIPT_NAME} --slug names ${refusals.length} row(s) that are not mint candidates, so nothing was planned or written:\n${refusals.join('\n')}`,
    );
  }
}

async function nonCandidateReason(slug: string): Promise<string> {
  const row = (await ResearchEntity.findOne({ slug })
    .select('archived studentVisibilityReasons')
    .lean()) as { archived?: boolean } | null;
  if (!row) return 'no research entity has this slug';
  if (row.archived) return 'archived';
  return 'not missing_lead';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();
  const result = await runMintFraNamedResearchers(args);
  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    ...result,
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
