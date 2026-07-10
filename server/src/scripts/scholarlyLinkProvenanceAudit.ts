import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchScholarlyAttribution } from '../models/researchScholarlyAttribution';
import { ResearchScholarlyLink } from '../models/researchScholarlyLink';
import { buildScholarlyActivityAudit } from '../services/scholarlyActivityAuditService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);

export interface ScholarlyLinkProvenanceAuditCliOptions {
  apply: boolean;
  confirmScholarlyLinkApply: boolean;
  maxApply?: number;
  sampleLimit: number;
  output?: string;
}

export function parseScholarlyLinkProvenanceAuditArgs(
  argv: string[],
): ScholarlyLinkProvenanceAuditCliOptions {
  const options: ScholarlyLinkProvenanceAuditCliOptions = {
    apply: false,
    confirmScholarlyLinkApply: false,
    sampleLimit: 20,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--confirm-scholarly-link-apply') {
      options.confirmScholarlyLinkApply = true;
    } else if (arg.startsWith('--max-apply=')) {
      options.maxApply = parsePositiveInteger(arg.slice('--max-apply='.length), '--max-apply');
    } else if (arg === '--max-apply') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) throw new Error('--max-apply requires a value');
      options.maxApply = parsePositiveInteger(next, '--max-apply');
      i += 1;
    } else if (arg.startsWith('--sample-limit=')) {
      options.sampleLimit = parseNonNegativeInteger(
        arg.slice('--sample-limit='.length),
        '--sample-limit',
      );
    } else if (arg === '--output') {
      const next = argv[i + 1];
      options.output = resolveSafeJsonReportOutputPath(next);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

export function assertScholarlyLinkProvenanceAuditApplyAllowed(
  options: ScholarlyLinkProvenanceAuditCliOptions,
  env: NodeJS.ProcessEnv = process.env,
  mongoUrl?: string,
  plannedChanges?: number,
) {
  if (options.apply && !options.confirmScholarlyLinkApply) {
    throw new Error(
      '--confirm-scholarly-link-apply is required when --apply is set for scholarly-links:provenance-audit',
    );
  }
  if (options.apply && typeof options.maxApply !== 'number') {
    throw new Error('--max-apply is required when --apply is set for scholarly-links:provenance-audit');
  }
  if (
    options.apply &&
    typeof options.maxApply === 'number' &&
    typeof plannedChanges === 'number' &&
    plannedChanges > options.maxApply
  ) {
    throw new Error(`Apply would modify ${plannedChanges} rows, above --max-apply.`);
  }
  return assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'scholarlyLinkProvenanceAudit',
    mongoUrl,
    env,
  });
}

function parsePositiveInteger(value: string, flag: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeInteger(value: string, flag: string): number {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  return parsed;
}

export function writeScholarlyLinkProvenanceAuditOutput(report: unknown, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

export function buildScholarlyLinkProvenanceAuditOutput(
  target: { environment: string; db: string; options?: ScholarlyLinkProvenanceAuditCliOptions },
  report: Record<string, unknown>,
  generatedAt = new Date(),
): Record<string, unknown> {
  return {
    generatedAt: generatedAt.toISOString(),
    environment: target.environment,
    db: target.db,
    ...(target.options ? { options: target.options } : {}),
    ...report,
  };
}

const nullTargetAttributionFilter = {
  archived: { $ne: true },
  $or: [{ targetUserId: { $exists: false } }, { targetUserId: null }],
};

const ownerlessLinkFilter = {
  archived: { $ne: true },
  $and: [
    { $or: [{ userId: { $exists: false } }, { userId: null }] },
    { $or: [{ researchEntityId: { $exists: false } }, { researchEntityId: null }] },
  ],
};

async function orphanAttributionIds(): Promise<mongoose.Types.ObjectId[]> {
  const rows = await ResearchScholarlyAttribution.aggregate([
    { $match: { archived: { $ne: true } } },
    {
      $lookup: {
        from: 'research_scholarly_links',
        localField: 'scholarlyLinkId',
        foreignField: '_id',
        as: 'link',
      },
    },
    { $match: { link: { $eq: [] } } },
    { $project: { _id: 1 } },
  ]);
  return rows.map((row) => row._id).filter(Boolean);
}

async function main() {
  const options = parseScholarlyLinkProvenanceAuditArgs(process.argv.slice(2));
  const guard = assertScholarlyLinkProvenanceAuditApplyAllowed(
    options,
    process.env,
    process.env.MONGODBURL,
  );

  await initializeConnections();
  const before = await buildScholarlyActivityAudit();
  const orphanIds = await orphanAttributionIds();
  const plannedChanges =
    before.counts.nullTargetAttributions +
    orphanIds.length +
    before.counts.activeLinksWithoutOwner;
  assertScholarlyLinkProvenanceAuditApplyAllowed(
    options,
    process.env,
    process.env.MONGODBURL,
    plannedChanges,
  );

  const samples =
    options.sampleLimit > 0
      ? {
          nullTargetAttributions: await ResearchScholarlyAttribution.find(
            nullTargetAttributionFilter,
          )
            .select('_id scholarlyLinkId relationshipBasis evidenceLabel sourceName sourceUrl')
            .limit(options.sampleLimit)
            .lean(),
          ownerlessLinks: await ResearchScholarlyLink.find(ownerlessLinkFilter)
            .select('_id title url sourceUrl displaySource externalIds')
            .limit(options.sampleLimit)
            .lean(),
        }
      : undefined;

  let nullTargetSuppressed = 0;
  let orphanSuppressed = 0;
  let ownerlessLinksSuppressed = 0;
  if (options.apply) {
    const archivedAt = new Date();
    const [nullTargetResult, orphanResult, ownerlessResult] = await Promise.all([
      ResearchScholarlyAttribution.updateMany(nullTargetAttributionFilter, {
        $set: {
          archived: true,
          archivedReason: 'missing_target_user_for_public_research_activity',
          archivedAt,
        },
      }),
      orphanIds.length
        ? ResearchScholarlyAttribution.updateMany(
            { _id: { $in: orphanIds }, archived: { $ne: true } },
            {
              $set: {
                archived: true,
                archivedReason: 'missing_scholarly_link_for_public_research_activity',
                archivedAt,
              },
            },
          )
        : Promise.resolve({ modifiedCount: 0 }),
      ResearchScholarlyLink.updateMany(ownerlessLinkFilter, {
        $set: {
          archived: true,
          archivedReason: 'missing_owner_for_public_research_activity',
          archivedAt,
        },
      }),
    ]);
    nullTargetSuppressed = nullTargetResult.modifiedCount || 0;
    orphanSuppressed = orphanResult.modifiedCount || 0;
    ownerlessLinksSuppressed = ownerlessResult.modifiedCount || 0;
  }

  const after = await buildScholarlyActivityAudit();
  const report = buildScholarlyLinkProvenanceAuditOutput(
    {
      environment: guard.environment,
      db: guard.dbLabel,
      options,
    },
    {
      mode: options.apply ? 'apply' : 'dry-run',
      before,
      applied: {
        nullTargetSuppressed,
        orphanSuppressed,
        ownerlessLinksSuppressed,
      },
      after,
      ...(samples ? { samples } : {}),
    },
  );

  console.log(JSON.stringify(report, null, 2));
  writeScholarlyLinkProvenanceAuditOutput(report, options.output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error('Failed to run scholarly link provenance audit:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
