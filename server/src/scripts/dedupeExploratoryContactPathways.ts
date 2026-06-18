import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { AccessSignal } from '../models/accessSignal';
import { ContactRoute } from '../models/contactRoute';
import { EntryPathway } from '../models/entryPathway';
import { initializeConnections } from '../db/connections';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';

dotenv.config();

export interface DedupeExploratoryContactPathwaysCliOptions {
  apply: boolean;
  confirmExploratoryDedupeApply: boolean;
  limit: number;
  limitProvided?: boolean;
  maxApply?: number;
  output?: string;
}

function parsePositiveInteger(value: string | undefined, flag: string): number {
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a number`);
  }
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

interface PathwayPlan {
  researchEntityId: string;
  canonicalPathwayId: string;
  duplicatePathwayIds: string[];
  canonicalDerivationKey: string;
  duplicateDerivationKeys: string[];
  relinkedAccessSignals: number;
  relinkedContactRoutes: number;
}

const DEDUPE_EXPLORATORY_PATHWAY_OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

export function normalizeDedupeExploratoryContactPathwayObjectId(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return DEDUPE_EXPLORATORY_PATHWAY_OBJECT_ID_RE.test(trimmed) ? trimmed : undefined;
  }
  if (value instanceof mongoose.Types.ObjectId) return value.toHexString();
  return undefined;
}

const idString = (value: unknown): string => {
  return serializedDocumentId(value) || '';
};

export function parseDedupeExploratoryContactPathwaysArgs(
  argv: string[],
): DedupeExploratoryContactPathwaysCliOptions {
  const options: DedupeExploratoryContactPathwaysCliOptions = {
    apply: false,
    confirmExploratoryDedupeApply: false,
    limit: 1000,
    limitProvided: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--mode=apply') {
      options.apply = true;
    } else if (arg === '--dry-run' || arg === '--mode=dry-run') {
      options.apply = false;
    } else if (arg === '--confirm-exploratory-dedupe-apply') {
      options.confirmExploratoryDedupeApply = true;
    } else if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
      options.limitProvided = true;
    } else if (arg === '--limit') {
      options.limit = parsePositiveInteger(argv[i + 1], '--limit');
      options.limitProvided = true;
      i += 1;
    } else if (arg.startsWith('--max-apply=')) {
      options.maxApply = parsePositiveInteger(arg.slice('--max-apply='.length), '--max-apply');
    } else if (arg === '--max-apply') {
      options.maxApply = parsePositiveInteger(argv[i + 1], '--max-apply');
      i += 1;
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

export function assertDedupeExploratoryContactPathwaysApplyConfirmed(
  options: DedupeExploratoryContactPathwaysCliOptions,
  plannedChanges?: number,
): void {
  if (options.apply && !options.confirmExploratoryDedupeApply) {
    throw new Error(
      '--confirm-exploratory-dedupe-apply is required when --apply is set for pathways:dedupe-exploratory.',
    );
  }
  if (options.apply && !options.limitProvided) {
    throw new Error('--limit is required when --apply is set for pathways:dedupe-exploratory.');
  }
  if (options.apply && options.maxApply === undefined) {
    throw new Error('--max-apply is required when --apply is set for pathways:dedupe-exploratory.');
  }
  if (options.apply && plannedChanges !== undefined && plannedChanges > options.maxApply!) {
    throw new Error(
      `Apply would modify ${plannedChanges} pathway-related rows, above --max-apply.`,
    );
  }
}

export function writeDedupeExploratoryContactPathwaysOutput(
  report: Record<string, unknown>,
  output?: string,
): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

export function buildDedupeExploratoryContactPathwaysOutput(
  target: {
    environment: string;
    db: string;
    options?: DedupeExploratoryContactPathwaysCliOptions;
  },
  report: Record<string, unknown>,
  generatedAt = new Date(),
): Record<string, unknown> {
  if (target.options) {
    assertDedupeExploratoryContactPathwaysApplyConfirmed(target.options);
  }
  return {
    generatedAt: generatedAt.toISOString(),
    environment: target.environment,
    db: target.db,
    ...(target.options ? { options: target.options } : {}),
    ...report,
  };
}

async function buildPlans(limit: number): Promise<PathwayPlan[]> {
  const groups = await EntryPathway.aggregate([
    {
      $match: {
        archived: { $ne: true },
        pathwayType: 'EXPLORATORY_CONTACT',
        researchEntityId: { $exists: true, $ne: null },
      },
    },
    {
      $group: {
        _id: '$researchEntityId',
        ids: { $push: '$_id' },
      },
    },
    { $match: { 'ids.1': { $exists: true } } },
    { $limit: limit },
  ]);

  const plans: PathwayPlan[] = [];

  for (const group of groups) {
    const pathways = await EntryPathway.find({ _id: { $in: group.ids } }).lean();
    const scored = await Promise.all(
      pathways.map(async (pathway: any) => {
        const pathwayId = idString(pathway._id);
        const [accessSignals, contactRoutes] = await Promise.all([
          AccessSignal.countDocuments({ entryPathwayId: pathwayId, archived: { $ne: true } }),
          ContactRoute.countDocuments({ entryPathwayId: pathwayId, archived: { $ne: true } }),
        ]);
        const sourceEvidenceCount = Array.isArray(pathway.sourceEvidenceIds)
          ? pathway.sourceEvidenceIds.length
          : 0;
        const sourceUrlCount = Array.isArray(pathway.sourceUrls) ? pathway.sourceUrls.length : 0;
        const derivationKey = String(pathway.derivationKey || '');
        const derivationScore = /ACCEPTING_SIGNAL|CURRENT_UNDERGRADS|PAST_UNDERGRADS/.test(
          derivationKey,
        )
          ? 4
          : /OFFICIAL_PROFILE/.test(derivationKey)
            ? 2
            : 0;
        const score =
          accessSignals * 20 +
          contactRoutes * 20 +
          sourceEvidenceCount * 5 +
          sourceUrlCount * 3 +
          derivationScore +
          Number(pathway.confidence || 0);
        return { pathway, pathwayId, score, accessSignals, contactRoutes };
      }),
    );

    scored.sort((a, b) => b.score - a.score || a.pathwayId.localeCompare(b.pathwayId));
    const canonical = scored[0];
    const duplicates = scored.slice(1);
    if (!canonical || duplicates.length === 0) continue;

    plans.push({
      researchEntityId: idString(group._id),
      canonicalPathwayId: canonical.pathwayId,
      duplicatePathwayIds: duplicates.map((entry) => entry.pathwayId),
      canonicalDerivationKey: String(canonical.pathway.derivationKey || ''),
      duplicateDerivationKeys: duplicates.map((entry) => String(entry.pathway.derivationKey || '')),
      relinkedAccessSignals: duplicates.reduce((sum, entry) => sum + entry.accessSignals, 0),
      relinkedContactRoutes: duplicates.reduce((sum, entry) => sum + entry.contactRoutes, 0),
    });
  }

  return plans;
}

async function applyPlans(plans: PathwayPlan[]) {
  const applied = [];
  for (const plan of plans) {
    const canonicalPathwayId = normalizeDedupeExploratoryContactPathwayObjectId(plan.canonicalPathwayId);
    const duplicatePathwayIds = plan.duplicatePathwayIds
      .map((id) => normalizeDedupeExploratoryContactPathwayObjectId(id))
      .filter((id): id is string => Boolean(id));
    if (!canonicalPathwayId || duplicatePathwayIds.length === 0) continue;
    const duplicateIds = duplicatePathwayIds.map((id) => new mongoose.Types.ObjectId(id));
    const canonicalId = new mongoose.Types.ObjectId(canonicalPathwayId);
    const [accessSignals, contactRoutes, pathways] = await Promise.all([
      AccessSignal.updateMany(
        { entryPathwayId: { $in: duplicateIds }, archived: { $ne: true } },
        { $set: { entryPathwayId: canonicalId } },
      ),
      ContactRoute.updateMany(
        { entryPathwayId: { $in: duplicateIds }, archived: { $ne: true } },
        { $set: { entryPathwayId: canonicalId } },
      ),
      EntryPathway.updateMany(
        { _id: { $in: duplicateIds } },
        { $set: { archived: true, review: { status: 'resolved' } } },
      ),
    ]);
    applied.push({
      ...plan,
      accessSignalsModified: accessSignals.modifiedCount,
      contactRoutesModified: contactRoutes.modifiedCount,
      archivedPathways: pathways.modifiedCount,
    });
  }
  return applied;
}

export function countDedupeExploratoryContactPathwaysPlannedChanges(
  plans: Array<
    Pick<PathwayPlan, 'duplicatePathwayIds' | 'relinkedAccessSignals' | 'relinkedContactRoutes'>
  >,
): number {
  return plans.reduce(
    (sum, plan) =>
      sum +
      plan.duplicatePathwayIds.length +
      plan.relinkedAccessSignals +
      plan.relinkedContactRoutes,
    0,
  );
}

async function main() {
  const options = parseDedupeExploratoryContactPathwaysArgs(process.argv.slice(2));
  assertDedupeExploratoryContactPathwaysApplyConfirmed(options);
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'pathways:dedupe-exploratory',
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();
  const plans = await buildPlans(options.limit);
  const plannedDuplicatePathways = plans.reduce(
    (sum, plan) => sum + plan.duplicatePathwayIds.length,
    0,
  );
  const plannedRelinkedAccessSignals = plans.reduce(
    (sum, plan) => sum + plan.relinkedAccessSignals,
    0,
  );
  const plannedRelinkedContactRoutes = plans.reduce(
    (sum, plan) => sum + plan.relinkedContactRoutes,
    0,
  );
  const plannedApplyChanges = countDedupeExploratoryContactPathwaysPlannedChanges(plans);
  assertDedupeExploratoryContactPathwaysApplyConfirmed(options, plannedApplyChanges);
  const applied = options.apply ? await applyPlans(plans) : [];

  const report = buildDedupeExploratoryContactPathwaysOutput(
    {
      environment: guard.environment,
      db: guard.dbLabel,
      options,
    },
    {
      mode: options.apply ? 'apply' : 'dry-run',
      plannedGroups: plans.length,
      plannedDuplicatePathways,
      plannedRelinkedAccessSignals,
      plannedRelinkedContactRoutes,
      plannedApplyChanges,
      plans,
      applied,
    },
  );

  console.log(JSON.stringify(report, null, 2));
  writeDedupeExploratoryContactPathwaysOutput(report, options.output);
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to dedupe exploratory contact pathways:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
