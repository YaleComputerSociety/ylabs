import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { STUDENT_VISIBILITY_VERSION } from '../services/studentVisibilityTier';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import {
  evaluateResearchOperatorApproval,
  OPERATOR_APPROVAL_RULE_VERSION,
  type OperatorApprovalCandidate,
} from './studentVisibilityOperatorApprovalRules';

dotenv.config();

interface CliOptions {
  apply: boolean;
  limit: number;
  collection: 'research';
  reviewerId?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    apply: false,
    limit: Infinity,
    collection: 'research',
  };

  for (const arg of argv) {
    if (arg === '--apply') {
      options.apply = true;
    } else if (arg.startsWith('--limit=')) {
      const parsed = Number(arg.slice('--limit='.length));
      options.limit = Number.isFinite(parsed) && parsed > 0 ? parsed : Infinity;
    } else if (arg === '--collection=research') {
      options.collection = 'research';
    } else if (arg.startsWith('--reviewer-id=')) {
      options.reviewerId = arg.slice('--reviewer-id='.length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

async function planResearchApprovals(limit: number): Promise<OperatorApprovalCandidate[]> {
  const query = ResearchEntity.find({
    archived: { $ne: true },
    studentVisibilityTier: 'operator_review',
  })
    .select('name slug studentVisibilityTier studentVisibilityComputedTier studentVisibilityReasons')
    .sort({ name: 1 });
  if (Number.isFinite(limit)) query.limit(limit);

  const rows = await query.lean();
  return rows
    .map((row: any) =>
      evaluateResearchOperatorApproval({
        id: String(row._id),
        label: row.name || row.slug || String(row._id),
        currentTier: row.studentVisibilityTier,
        computedTier: row.studentVisibilityComputedTier,
        reasons: row.studentVisibilityReasons || [],
      }),
    )
    .filter((candidate): candidate is OperatorApprovalCandidate => Boolean(candidate));
}

async function applyResearchApprovals(
  candidates: OperatorApprovalCandidate[],
  options: Pick<CliOptions, 'reviewerId'>,
) {
  const reviewedAt = new Date();
  const reviewedByUserId =
    options.reviewerId && mongoose.Types.ObjectId.isValid(options.reviewerId)
      ? new mongoose.Types.ObjectId(options.reviewerId)
      : undefined;

  for (const candidate of candidates) {
    await ResearchEntity.updateOne(
      { _id: candidate.id, studentVisibilityTier: 'operator_review' },
      {
        $set: {
          studentVisibilityTier: candidate.targetTier,
          studentVisibilityOverrideTier: candidate.targetTier,
          studentVisibilityComputedTier: candidate.computedTier || 'operator_review',
          studentVisibilityReasons: Array.from(
            new Set([...candidate.reasons, 'operator_override', candidate.ruleId]),
          ),
          studentVisibilityComputedAt: reviewedAt,
          studentVisibilityVersion: STUDENT_VISIBILITY_VERSION,
          studentVisibilityReviewedAt: reviewedAt,
          studentVisibilityReviewRuleId: candidate.ruleId,
          studentVisibilityReviewNote: candidate.reviewNote,
          ...(reviewedByUserId ? { studentVisibilityReviewedByUserId: reviewedByUserId } : {}),
        },
      },
    );
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'approveStudentVisibilityRules',
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();
  const research = await planResearchApprovals(options.limit);

  if (options.apply) {
    await applyResearchApprovals(research, options);
  }

  console.log(
    JSON.stringify(
      {
        mode: options.apply ? 'apply' : 'dry-run',
        environment: guard.environment,
        db: guard.dbLabel,
        collection: options.collection,
        ruleVersion: OPERATOR_APPROVAL_RULE_VERSION,
        candidateCounts: {
          research: research.length,
        },
        targetCounts: research.reduce<Record<string, number>>((acc, candidate) => {
          acc[candidate.targetTier] = (acc[candidate.targetTier] || 0) + 1;
          return acc;
        }, {}),
        rules: Array.from(
          new Map(
            research.map((candidate) => [
              candidate.ruleId,
              {
                ruleId: candidate.ruleId,
                ruleLabel: candidate.ruleLabel,
                targetTier: candidate.targetTier,
                reviewNote: candidate.reviewNote,
              },
            ]),
          ).values(),
        ),
        samples: {
          research: research.slice(0, 20),
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error('Failed to approve student visibility rules:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
