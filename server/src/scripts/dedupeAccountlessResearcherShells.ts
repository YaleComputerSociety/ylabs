import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  buildCanonicalNameIndex,
  decideShellMerge,
  roleAssignmentEdgeKey,
  type ShellMergeReason,
} from './dedupeAccountlessResearcherShellsCore';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);

export interface DedupeAccountlessResearcherShellsArgs {
  apply: boolean;
  confirmDedupeAccountlessResearcherShells: boolean;
  output?: string;
}

export function parseDedupeAccountlessResearcherShellsArgs(
  argv: string[],
): DedupeAccountlessResearcherShellsArgs {
  const args: DedupeAccountlessResearcherShellsArgs = {
    apply: false,
    confirmDedupeAccountlessResearcherShells: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--apply' || arg === '--mode=apply') {
      args.apply = true;
      continue;
    }
    if (arg === '--dry-run' || arg === '--mode=dry-run') {
      args.apply = false;
      continue;
    }
    if (arg === '--confirm-dedupe-accountless-researcher-shells') {
      args.confirmDedupeAccountlessResearcherShells = true;
      continue;
    }
    if (arg.startsWith('--confirm-dedupe-accountless-researcher-shells=')) {
      throw new Error('--confirm-dedupe-accountless-researcher-shells does not accept a value');
    }
    if (arg.startsWith('--output=')) {
      args.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
      continue;
    }
    if (arg === '--output') {
      args.output = resolveSafeJsonReportOutputPath(argv[index + 1]);
      index += 1;
      continue;
    }
    throw new Error(`Unknown dedupe:accountless-researcher-shells argument: ${arg}`);
  }

  return args;
}

export function assertDedupeAccountlessResearcherShellsApplyAllowed(
  args: Pick<
    DedupeAccountlessResearcherShellsArgs,
    'apply' | 'confirmDedupeAccountlessResearcherShells'
  >,
): void {
  if (args.apply && !args.confirmDedupeAccountlessResearcherShells) {
    throw new Error(
      '--confirm-dedupe-accountless-researcher-shells is required when --apply is set for dedupe:accountless-researcher-shells',
    );
  }
}

export interface DedupeAccountlessResearcherShellsResult {
  mode: 'apply' | 'dry-run';
  accountLinkedResearchers: number;
  accountlessResearchers: number;
  byReason: Record<ShellMergeReason, number>;
  shellsMerged: number;
  roleAssignmentsRepointed: number;
  roleAssignmentsArchivedRedundant: number;
  merges: Array<{
    shellId: string;
    canonicalId: string;
    repointed: string[];
    archivedRedundant: string[];
  }>;
}

const idKey = (value: unknown): string => (value == null ? '' : String(value));

export async function dedupeAccountlessResearcherShells(options: {
  apply: boolean;
}): Promise<DedupeAccountlessResearcherShellsResult> {
  const Researcher = mongoose.connection.collection('researchers');
  const RoleAssignment = mongoose.connection.collection('role_assignments');

  const accountLinked = await Researcher.find(
    { accountId: { $exists: true, $ne: null }, archived: { $ne: true } },
    { projection: { displayName: 1, 'identifiers.orcid': 1 } },
  ).toArray();

  const accountless = await Researcher.find(
    { $or: [{ accountId: { $exists: false } }, { accountId: null }], archived: { $ne: true } },
    { projection: { displayName: 1, 'identifiers.orcid': 1 } },
  ).toArray();

  const canonicalIndex = buildCanonicalNameIndex(
    accountLinked.map((doc: any) => ({
      id: idKey(doc._id),
      displayName: doc.displayName,
      orcid: doc.identifiers?.orcid,
    })),
  );

  const byReason: Record<ShellMergeReason, number> = {
    MERGEABLE: 0,
    NO_NAME: 0,
    NO_CANONICAL: 0,
    AMBIGUOUS_MULTIPLE_CANONICAL: 0,
    ORCID_CONFLICT: 0,
  };

  const mergeTargetByShellId = new Map<string, string>();
  for (const shell of accountless as any[]) {
    const decision = decideShellMerge(
      { displayName: shell.displayName, orcid: shell.identifiers?.orcid },
      canonicalIndex,
    );
    byReason[decision.reason] += 1;
    if (decision.merge && decision.canonicalId) {
      mergeTargetByShellId.set(idKey(shell._id), decision.canonicalId);
    }
  }

  const shellObjectIds = Array.from(mergeTargetByShellId.keys()).map(
    (id) => new mongoose.Types.ObjectId(id),
  );
  const canonicalObjectIds = Array.from(new Set(mergeTargetByShellId.values())).map(
    (id) => new mongoose.Types.ObjectId(id),
  );

  const shellRoleAssignments = shellObjectIds.length
    ? await RoleAssignment.find({
        personId: { $in: shellObjectIds },
        archived: { $ne: true },
      }).toArray()
    : [];
  const canonicalRoleAssignments = canonicalObjectIds.length
    ? await RoleAssignment.find({
        personId: { $in: canonicalObjectIds },
        archived: { $ne: true },
      }).toArray()
    : [];

  const canonicalEdgeKeys = new Map<string, Set<string>>();
  for (const ra of canonicalRoleAssignments as any[]) {
    const personId = idKey(ra.personId);
    const key = roleAssignmentEdgeKey({
      targetKind: ra.target?.kind,
      targetId: ra.target?.id,
      role: ra.role,
    });
    const set = canonicalEdgeKeys.get(personId) ?? new Set<string>();
    set.add(key);
    canonicalEdgeKeys.set(personId, set);
  }

  const mergesByShell = new Map<string, { repointed: string[]; archivedRedundant: string[] }>();
  for (const ra of shellRoleAssignments as any[]) {
    const shellId = idKey(ra.personId);
    const canonicalId = mergeTargetByShellId.get(shellId);
    if (!canonicalId) continue;
    const entry = mergesByShell.get(shellId) ?? { repointed: [], archivedRedundant: [] };
    const edgeKey = roleAssignmentEdgeKey({
      targetKind: ra.target?.kind,
      targetId: ra.target?.id,
      role: ra.role,
    });
    const canonicalEdges = canonicalEdgeKeys.get(canonicalId) ?? new Set<string>();
    if (canonicalEdges.has(edgeKey)) {
      entry.archivedRedundant.push(idKey(ra._id));
    } else {
      entry.repointed.push(idKey(ra._id));
      canonicalEdges.add(edgeKey);
      canonicalEdgeKeys.set(canonicalId, canonicalEdges);
    }
    mergesByShell.set(shellId, entry);
  }

  const merges: DedupeAccountlessResearcherShellsResult['merges'] = [];
  let roleAssignmentsRepointed = 0;
  let roleAssignmentsArchivedRedundant = 0;

  const roleAssignmentOps: mongoose.mongo.AnyBulkWriteOperation[] = [];
  const researcherOps: mongoose.mongo.AnyBulkWriteOperation[] = [];

  for (const [shellId, canonicalId] of mergeTargetByShellId.entries()) {
    const edges = mergesByShell.get(shellId) ?? { repointed: [], archivedRedundant: [] };
    merges.push({ shellId, canonicalId, ...edges });
    roleAssignmentsRepointed += edges.repointed.length;
    roleAssignmentsArchivedRedundant += edges.archivedRedundant.length;

    for (const raId of edges.repointed) {
      roleAssignmentOps.push({
        updateOne: {
          filter: { _id: new mongoose.Types.ObjectId(raId) },
          update: { $set: { personId: new mongoose.Types.ObjectId(canonicalId) } },
        },
      });
    }
    for (const raId of edges.archivedRedundant) {
      roleAssignmentOps.push({
        updateOne: {
          filter: { _id: new mongoose.Types.ObjectId(raId) },
          update: { $set: { archived: true } },
        },
      });
    }
    researcherOps.push({
      updateOne: {
        filter: { _id: new mongoose.Types.ObjectId(shellId) },
        update: { $set: { archived: true } },
      },
    });
  }

  if (options.apply) {
    if (roleAssignmentOps.length) await RoleAssignment.bulkWrite(roleAssignmentOps, { ordered: false });
    if (researcherOps.length) await Researcher.bulkWrite(researcherOps, { ordered: false });
  }

  return {
    mode: options.apply ? 'apply' : 'dry-run',
    accountLinkedResearchers: accountLinked.length,
    accountlessResearchers: accountless.length,
    byReason,
    shellsMerged: mergeTargetByShellId.size,
    roleAssignmentsRepointed,
    roleAssignmentsArchivedRedundant,
    merges,
  };
}

function writeOutput(report: unknown, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

async function main() {
  const args = parseDedupeAccountlessResearcherShellsArgs(process.argv.slice(2));
  assertDedupeAccountlessResearcherShellsApplyAllowed(args);
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'dedupe:accountless-researcher-shells',
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();
  const result = await dedupeAccountlessResearcherShells({ apply: args.apply });

  const { merges, ...summary } = result;
  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    options: args,
    ...summary,
    mergeCount: merges.length,
  };
  console.log(JSON.stringify(report, null, 2));
  writeOutput({ ...report, merges }, args.output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error('Failed to dedupe accountless researcher shells:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
