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
import { canonicalProfileKey } from './mintFraNamedResearchersCore';
import {
  directoryPersonPageCandidates,
  headingNameFromHtml,
  planDirectoryLeadAttachment,
  type VerifiedDirectoryPage,
} from './attachDirectoryNamedLeadsCore';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'research-entity:attach-directory-named-leads';
const UA = 'Mozilla/5.0 (compatible; ylabs-linkcheck)';
const FETCH_SPACING_MS = 900;

interface Args {
  apply: boolean;
  confirm: boolean;
  maxApply: number;
  output?: string;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, confirm: false, maxApply: 120 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--dry-run') args.apply = false;
    else if (arg === '--confirm-attach-directory-leads') args.confirm = true;
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function verifyPage(url: string): Promise<VerifiedDirectoryPage> {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) return { status: response.status, headingName: '' };
    return { status: response.status, headingName: headingNameFromHtml(await response.text()) };
  } catch {
    return { status: 0, headingName: '' };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const researchers = (await Researcher.find({ archived: { $ne: true } })
    .select('_id displayName profileLinks')
    .lean()) as any[];
  const researchersByName = new Map<string, any[]>();
  const claimedProfileKeys = new Set<string>();
  for (const researcher of researchers) {
    const key = comparableName(researcher.displayName);
    if (key) researchersByName.set(key, [...(researchersByName.get(key) ?? []), researcher]);
    for (const link of researcher.profileLinks || []) {
      const profileKey = canonicalProfileKey(link?.url);
      if (profileKey) claimedProfileKeys.add(profileKey);
    }
  }

  const entities = (await ResearchEntity.find({
    archived: { $ne: true },
    studentVisibilityReasons: 'missing_lead',
  })
    .select('_id slug name entityType sourceUrls studentVisibilityReasons')
    .lean()) as any[];

  const candidateUrls = [
    ...new Set(entities.flatMap((entity) => directoryPersonPageCandidates(entity))),
  ];
  const verifiedPages = new Map<string, VerifiedDirectoryPage>();
  for (const url of candidateUrls) {
    verifiedPages.set(url, await verifyPage(url));
    await sleep(FETCH_SPACING_MS);
  }

  const planned: Array<{
    entityId: string;
    entityType?: string;
    personName: string;
    profileUrl: string;
    existingResearcherId?: string;
  }> = [];
  const refusedByAmbiguousResearcher: string[] = [];

  for (const entity of entities) {
    const plan = planDirectoryLeadAttachment(entity, verifiedPages, claimedProfileKeys);
    if (!plan) continue;
    const entityId = serializedDocumentId(entity._id);
    if (!entityId) continue;
    const existingRole = await RoleAssignment.countDocuments({
      'target.kind': 'RESEARCH_ENTITY',
      'target.id': new mongoose.Types.ObjectId(entityId),
      archived: { $ne: true },
    });
    if (existingRole > 0) continue;

    const matches = researchersByName.get(comparableName(plan.personName)) ?? [];
    if (matches.length > 1) {
      refusedByAmbiguousResearcher.push(entityId);
      continue;
    }
    planned.push({
      entityId,
      entityType: entity.entityType,
      personName: plan.personName,
      profileUrl: plan.profileUrl,
      existingResearcherId:
        matches.length === 1 ? (serializedDocumentId(matches[0]._id) ?? undefined) : undefined,
    });
  }

  if (args.apply) {
    if (!args.confirm)
      throw new Error('--confirm-attach-directory-leads is required when --apply is set.');
    if (planned.length > args.maxApply) {
      throw new Error(
        `Apply would write ${planned.length} leads, above --max-apply=${args.maxApply}.`,
      );
    }
  }

  let minted = 0;
  let attachedToExisting = 0;
  let promoted = 0;
  if (args.apply && planned.length > 0) {
    const now = new Date();
    for (const row of planned) {
      let personId = row.existingResearcherId
        ? new mongoose.Types.ObjectId(row.existingResearcherId)
        : undefined;
      if (!personId) {
        const researcher = await Researcher.create({
          displayName: row.personName,
          status: 'UNKNOWN',
          profileLinks: [
            {
              kind: 'YALE_OFFICIAL',
              purpose: 'PRIMARY_IDENTITY',
              url: row.profileUrl,
              verifiedAt: now,
              healthStatus: 'HEALTHY',
            },
          ],
        });
        personId = researcher._id as mongoose.Types.ObjectId;
        minted += 1;
      } else {
        attachedToExisting += 1;
      }
      await RoleAssignment.create({
        personId,
        target: { kind: 'RESEARCH_ENTITY', id: new mongoose.Types.ObjectId(row.entityId) },
        role: 'PI',
        state: 'CURRENT',
        confidence: 0.85,
        reviewStatus: 'UNREVIEWED',
      });
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

  const pageStatusTally = [...verifiedPages.values()].reduce<Record<string, number>>(
    (acc, page) => {
      acc[String(page.status)] = (acc[String(page.status)] || 0) + 1;
      return acc;
    },
    {},
  );

  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    mode: args.apply ? 'apply' : 'dry-run',
    leadBlockedExamined: entities.length,
    candidateDirectoryPages: candidateUrls.length,
    candidatePageStatuses: pageStatusTally,
    plannedLeads: planned.length,
    plannedMints: planned.filter((row) => !row.existingResearcherId).length,
    plannedAttachmentsToExisting: planned.filter((row) => row.existingResearcherId).length,
    refusedByAmbiguousResearcher: refusedByAmbiguousResearcher.length,
    minted,
    attachedToExisting,
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
