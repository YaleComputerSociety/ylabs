import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  applyUnionPlanToSnapshot,
  buildCanonicalNameIndex,
  decideShellMerge,
  planResearcherAttributeUnion,
  researcherAttributeUnionIsEmpty,
  roleAssignmentEdgeKey,
  RESEARCHER_UNIQUE_IDENTIFIER_FIELDS,
  type ResearcherAttributeSnapshot,
  type ShellMergeReason,
} from './dedupeAccountlessResearcherShellsCore';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);

export const SCRAPER_SWEEP_DEDUPE_RESEARCHERS_ENV = 'SCRAPER_SWEEP_DEDUPE_RESEARCHERS';

export function isResearcherDedupeStageEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = (env[SCRAPER_SWEEP_DEDUPE_RESEARCHERS_ENV] || '').trim().toLowerCase();
  return value === '1' || value === 'true';
}

export interface ResearcherDedupeStageDelta {
  byReason: Record<ShellMergeReason, number>;
  shellsMerged: number;
  roleAssignmentsRepointed: number;
  roleAssignmentsArchivedRedundant: number;
  profileLinksAppended: number;
}

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

export interface AttributeUnionTotals {
  profileLinksAppended: number;
  identifiersFilled: Record<string, number>;
  profileFieldsFilled: Record<string, number>;
}

export interface DedupeAccountlessResearcherShellsResult {
  mode: 'apply' | 'dry-run';
  accountLinkedResearchers: number;
  accountlessResearchers: number;
  byReason: Record<ShellMergeReason, number>;
  shellsMerged: number;
  roleAssignmentsRepointed: number;
  roleAssignmentsArchivedRedundant: number;
  attributeUnion: AttributeUnionTotals;
  merges: Array<{
    shellId: string;
    canonicalId: string;
    repointed: string[];
    archivedRedundant: string[];
    profileLinksAppended: number;
    identifiersFilled: string[];
    profileFieldsFilled: string[];
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

  const attributeProjection = { profileLinks: 1, identifiers: 1, profile: 1 } as const;
  const snapshotOf = (doc: any): ResearcherAttributeSnapshot => ({
    profileLinks: Array.isArray(doc?.profileLinks) ? doc.profileLinks : [],
    identifiers: doc?.identifiers ?? {},
    profile: doc?.profile ?? {},
  });

  const shellDocs = shellObjectIds.length
    ? await Researcher.find(
        { _id: { $in: shellObjectIds } },
        { projection: attributeProjection },
      ).toArray()
    : [];
  const canonicalDocs = canonicalObjectIds.length
    ? await Researcher.find(
        { _id: { $in: canonicalObjectIds } },
        { projection: attributeProjection },
      ).toArray()
    : [];

  const shellSnapshotById = new Map<string, ResearcherAttributeSnapshot>();
  for (const doc of shellDocs as any[]) shellSnapshotById.set(idKey(doc._id), snapshotOf(doc));
  const canonicalSnapshotById = new Map<string, ResearcherAttributeSnapshot>();
  for (const doc of canonicalDocs as any[]) {
    canonicalSnapshotById.set(idKey(doc._id), snapshotOf(doc));
  }

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

  const attributeUnion: AttributeUnionTotals = {
    profileLinksAppended: 0,
    identifiersFilled: {},
    profileFieldsFilled: {},
  };

  const roleAssignmentOps: mongoose.mongo.AnyBulkWriteOperation[] = [];
  const researcherOps: mongoose.mongo.AnyBulkWriteOperation[] = [];
  const dedupedAt = new Date();

  const canonicalMergeState = new Map<string, ResearcherAttributeSnapshot>();
  const canonicalAppendedLinks = new Map<string, ResearcherAttributeSnapshot['profileLinks']>();
  const canonicalSetFills = new Map<string, Record<string, string>>();

  for (const [shellId, canonicalId] of mergeTargetByShellId.entries()) {
    const edges = mergesByShell.get(shellId) ?? { repointed: [], archivedRedundant: [] };
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

    const canonicalState = canonicalMergeState.get(canonicalId) ??
      canonicalSnapshotById.get(canonicalId) ?? { profileLinks: [], identifiers: {}, profile: {} };
    const shellSnapshot = shellSnapshotById.get(shellId) ?? {
      profileLinks: [],
      identifiers: {},
      profile: {},
    };
    const plan = planResearcherAttributeUnion(canonicalState, shellSnapshot);

    if (!researcherAttributeUnionIsEmpty(plan)) {
      canonicalMergeState.set(canonicalId, applyUnionPlanToSnapshot(canonicalState, plan));

      const appendedForCanonical = canonicalAppendedLinks.get(canonicalId) ?? [];
      appendedForCanonical.push(...plan.profileLinksToAppend);
      canonicalAppendedLinks.set(canonicalId, appendedForCanonical);

      const setForCanonical = canonicalSetFills.get(canonicalId) ?? {};
      for (const [field, value] of Object.entries(plan.identifierGapFills)) {
        setForCanonical[`identifiers.${field}`] = value;
      }
      for (const [field, value] of Object.entries(plan.profileGapFills)) {
        setForCanonical[`profile.${field}`] = value;
      }
      canonicalSetFills.set(canonicalId, setForCanonical);
    }

    attributeUnion.profileLinksAppended += plan.profileLinksToAppend.length;
    for (const field of Object.keys(plan.identifierGapFills)) {
      attributeUnion.identifiersFilled[field] = (attributeUnion.identifiersFilled[field] ?? 0) + 1;
    }
    for (const field of Object.keys(plan.profileGapFills)) {
      attributeUnion.profileFieldsFilled[field] =
        (attributeUnion.profileFieldsFilled[field] ?? 0) + 1;
    }

    merges.push({
      shellId,
      canonicalId,
      repointed: edges.repointed,
      archivedRedundant: edges.archivedRedundant,
      profileLinksAppended: plan.profileLinksToAppend.length,
      identifiersFilled: Object.keys(plan.identifierGapFills),
      profileFieldsFilled: Object.keys(plan.profileGapFills),
    });

    const shellArchiveUpdate: Record<string, unknown> = {
      $set: {
        archived: true,
        dedupedIntoResearcherId: new mongoose.Types.ObjectId(canonicalId),
        dedupedAt,
      },
    };
    const transferredUniqueIdentifierUnsets: Record<string, ''> = {};
    for (const field of Object.keys(plan.identifierGapFills)) {
      if (RESEARCHER_UNIQUE_IDENTIFIER_FIELDS.has(field)) {
        transferredUniqueIdentifierUnsets[`identifiers.${field}`] = '';
      }
    }
    if (Object.keys(transferredUniqueIdentifierUnsets).length) {
      shellArchiveUpdate.$unset = transferredUniqueIdentifierUnsets;
    }

    researcherOps.push({
      updateOne: {
        filter: { _id: new mongoose.Types.ObjectId(shellId) },
        update: shellArchiveUpdate,
      },
    });
  }

  const canonicalIds = new Set<string>([
    ...canonicalAppendedLinks.keys(),
    ...canonicalSetFills.keys(),
  ]);
  const canonicalUnionOps: mongoose.mongo.AnyBulkWriteOperation[] = [];
  for (const canonicalId of canonicalIds) {
    const setFields = canonicalSetFills.get(canonicalId) ?? {};
    const appendedLinks = canonicalAppendedLinks.get(canonicalId) ?? [];
    const update: Record<string, unknown> = {};
    if (Object.keys(setFields).length) update.$set = setFields;
    if (appendedLinks.length) update.$push = { profileLinks: { $each: appendedLinks } };
    if (!Object.keys(update).length) continue;
    canonicalUnionOps.push({
      updateOne: {
        filter: { _id: new mongoose.Types.ObjectId(canonicalId) },
        update,
      },
    });
  }

  if (options.apply) {
    if (researcherOps.length) await Researcher.bulkWrite(researcherOps, { ordered: false });
    if (canonicalUnionOps.length) await Researcher.bulkWrite(canonicalUnionOps, { ordered: false });
    if (roleAssignmentOps.length)
      await RoleAssignment.bulkWrite(roleAssignmentOps, { ordered: false });
  }

  return {
    mode: options.apply ? 'apply' : 'dry-run',
    accountLinkedResearchers: accountLinked.length,
    accountlessResearchers: accountless.length,
    byReason,
    shellsMerged: mergeTargetByShellId.size,
    roleAssignmentsRepointed,
    roleAssignmentsArchivedRedundant,
    attributeUnion,
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
