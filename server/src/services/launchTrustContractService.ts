import {
  publicStudentVisibilityTiers,
  publicSafeStudentVisibilityTiers,
  type StudentVisibilityTier,
} from '../models/studentVisibility';
import type { VisibilityRepairStage } from '../models/visibilityReleaseQueueItem';
import {
  planStudentVisibilityGate,
  type StudentVisibilityGateCollection,
  type StudentVisibilityGatePlan,
} from './studentVisibilityGateService';
import {
  classifyVisibilityRepairStage,
  repairActionForStage,
} from './visibilityRepairQueueService';
import { buildPaperQualityAudit } from './paperQualityService';
import { buildScholarlyActivityAudit } from './scholarlyActivityAuditService';

export const LAUNCH_TRUST_CONTRACT_VERSION = 'launch-trust-v1';

export type LaunchTrustMode = 'student-ready-only' | 'public-safe';

export interface LaunchTrustContractOptions {
  collection: StudentVisibilityGateCollection;
  mode?: LaunchTrustMode;
  sourceName?: string;
  recordIds?: string[];
  limit?: number;
  includeResearchActivity?: boolean;
  includePaperQuality?: boolean;
}

export interface LaunchTrustRepairLane {
  stage: VisibilityRepairStage;
  count: number;
  reasons: Record<string, number>;
  command: string;
  nextAction: string;
  samples: Array<{
    collection: StudentVisibilityGatePlan['collection'];
    recordId: string;
    label: string;
    reasons: string[];
  }>;
}

export interface LaunchTrustViolation {
  collection: StudentVisibilityGatePlan['collection'];
  recordId: string;
  label: string;
  currentTier?: string;
  computedTier: StudentVisibilityTier;
  targetTier: StudentVisibilityTier;
  reasons: string[];
  repairStage: VisibilityRepairStage;
  publicVisibilityViolation: boolean;
}

export interface LaunchTrustContractReport {
  contractVersion: string;
  mode: LaunchTrustMode;
  collection: StudentVisibilityGateCollection;
  pass: boolean;
  counts: {
    scanned: number;
    launchEligible: number;
    limitedButSafe: number;
    held: number;
    suppressed: number;
    publicVisibilityViolations: number;
  };
  repairLanes: LaunchTrustRepairLane[];
  violations: LaunchTrustViolation[];
  researchActivity?: {
    pass: boolean;
    counts: Record<string, number>;
    command: string;
    fixCommand: string;
  };
  paperQuality?: {
    pass: boolean;
    counts: Record<string, number>;
    command: string;
    fixCommands: string[];
  };
  requiredCommands: string[];
}

const publicTiers = new Set<string>(publicStudentVisibilityTiers);
const publicSafeTiers = new Set<string>(publicSafeStudentVisibilityTiers);
const BETA_COMMAND_PREFIX = 'SCRAPER_ENV=beta ';

function betaCommand(command: string): string {
  const trimmed = command.trim();
  if (!trimmed || trimmed.startsWith(BETA_COMMAND_PREFIX)) return trimmed;
  if (/^[A-Z_][A-Z0-9_]*=/.test(trimmed)) return trimmed;
  if (trimmed.startsWith('yarn --cwd server ') || trimmed.startsWith('yarn scrape ')) {
    return `${BETA_COMMAND_PREFIX}${trimmed}`;
  }
  return command;
}

const launchEligibleTier = (tier: StudentVisibilityTier, mode: LaunchTrustMode): boolean => {
  if (mode === 'public-safe') return publicSafeTiers.has(tier);
  return tier === 'student_ready';
};

const increment = (counts: Record<string, number>, key: string) => {
  counts[key] = (counts[key] || 0) + 1;
};

const laneCommand = (
  stage: VisibilityRepairStage,
  collection: StudentVisibilityGateCollection,
): string => {
  const collectionArg = collection === 'all' ? '--collection=all' : `--collection=${collection}`;
  const dryRunRepairCommand = (
    repairStage: VisibilityRepairStage,
    outputName: string,
    limit: number,
    extraArgs = '',
  ) =>
    betaCommand(
      [
        'yarn --cwd server beta:repair-queue',
        collectionArg,
        `--stage=${repairStage}`,
        '--mode=dry-run',
        '--retry-blocked',
        `--limit=${limit}`,
        extraArgs,
        `--output /tmp/${outputName}`,
      ]
        .filter(Boolean)
        .join(' '),
    );

  if (stage === 'source_description') {
    return dryRunRepairCommand(
      'source_description',
      'ylabs-beta-repair-source-description.json',
      500,
    );
  }
  if (stage === 'pi_identity') {
    return dryRunRepairCommand('pi_identity', 'ylabs-beta-repair-pi-identity.json', 250);
  }
  if (stage === 'action_evidence') {
    return dryRunRepairCommand(
      'action_evidence',
      'ylabs-beta-repair-action-evidence.json',
      250,
    );
  }
  if (stage === 'suppression') {
    return dryRunRepairCommand(
      'suppression',
      'ylabs-beta-repair-suppression.json',
      250,
      '--suppress-unsafe',
    );
  }
  return betaCommand(
    `yarn --cwd server launch:review-exceptions ${collectionArg} --limit=500 --decision-template-output /tmp/ylabs-launch-review-exceptions-template.json --accepted-decisions=/tmp/ylabs-launch-review-exceptions-decisions.json --allow-empty-decisions --output /tmp/ylabs-launch-review-exceptions.json`,
  );
};

function buildRepairLanes(
  violations: LaunchTrustViolation[],
  collection: StudentVisibilityGateCollection,
): LaunchTrustRepairLane[] {
  const byStage = new Map<VisibilityRepairStage, LaunchTrustRepairLane>();

  for (const violation of violations) {
    const lane =
      byStage.get(violation.repairStage) ||
      ({
        stage: violation.repairStage,
        count: 0,
        reasons: {},
        command: laneCommand(violation.repairStage, collection),
        nextAction: repairActionForStage(violation.repairStage, violation.reasons),
        samples: [],
      } satisfies LaunchTrustRepairLane);

    lane.count += 1;
    for (const reason of violation.reasons) increment(lane.reasons, reason);
    if (lane.samples.length < 10) {
      lane.samples.push({
        collection: violation.collection,
        recordId: violation.recordId,
        label: violation.label,
        reasons: violation.reasons,
      });
    }
    byStage.set(violation.repairStage, lane);
  }

  const stageOrder: Record<VisibilityRepairStage, number> = {
    source_description: 0,
    pi_identity: 1,
    action_evidence: 2,
    suppression: 3,
    review_exception: 4,
  };

  return Array.from(byStage.values()).sort(
    (a, b) => stageOrder[a.stage] - stageOrder[b.stage],
  );
}

export function buildLaunchTrustContractReport(
  plans: StudentVisibilityGatePlan[],
  options: Required<Pick<LaunchTrustContractOptions, 'collection' | 'mode'>> & {
    researchActivity?: LaunchTrustContractReport['researchActivity'];
    paperQuality?: LaunchTrustContractReport['paperQuality'];
  },
): LaunchTrustContractReport {
  const counts = {
    scanned: plans.length,
    launchEligible: 0,
    limitedButSafe: 0,
    held: 0,
    suppressed: 0,
    publicVisibilityViolations: 0,
  };
  const violations: LaunchTrustViolation[] = [];

  for (const plan of plans) {
    if (launchEligibleTier(plan.tier, options.mode)) counts.launchEligible += 1;
    if (plan.tier === 'limited_but_safe') counts.limitedButSafe += 1;
    if (plan.tier === 'operator_review') counts.held += 1;
    if (plan.tier === 'suppressed') counts.suppressed += 1;

    const currentPublic = publicTiers.has(plan.currentTier || '');
    const launchEligible = launchEligibleTier(plan.tier, options.mode);
    const publicVisibilityViolation = currentPublic && !launchEligible;
    if (publicVisibilityViolation) counts.publicVisibilityViolations += 1;

    const suppressedAndHidden = plan.tier === 'suppressed' && !publicVisibilityViolation;
    if ((!launchEligible && !suppressedAndHidden) || publicVisibilityViolation) {
      const repairStage = classifyVisibilityRepairStage(plan.reasons);
      violations.push({
        collection: plan.collection,
        recordId: plan.recordId,
        label: plan.label,
        currentTier: plan.currentTier,
        computedTier: plan.computedTier,
        targetTier: plan.tier,
        reasons: plan.reasons,
        repairStage,
        publicVisibilityViolation,
      });
    }
  }

  const repairLanes = buildRepairLanes(violations, options.collection);
  const gateCollectionArg =
    options.collection === 'all'
      ? '--collection=all'
      : `--collection=${options.collection}`;
  const gateCommand = betaCommand(
    `yarn --cwd server student-visibility:gate ${gateCollectionArg} --mode=dry-run --output /tmp/ylabs-student-visibility-gate.json`,
  );
  const researchActivity = options.researchActivity
    ? {
        ...options.researchActivity,
        command: betaCommand(options.researchActivity.command),
        fixCommand: betaCommand(options.researchActivity.fixCommand),
      }
    : undefined;
  const paperQuality = options.paperQuality
    ? {
        ...options.paperQuality,
        command: betaCommand(options.paperQuality.command),
        fixCommands: options.paperQuality.fixCommands.map(betaCommand),
      }
    : undefined;

  return {
    contractVersion: LAUNCH_TRUST_CONTRACT_VERSION,
    mode: options.mode,
    collection: options.collection,
    pass:
      violations.length === 0 &&
      counts.publicVisibilityViolations === 0 &&
      (researchActivity?.pass ?? true) &&
      (paperQuality?.pass ?? true),
    counts,
    repairLanes,
    violations: violations.slice(0, 50),
    ...(researchActivity ? { researchActivity } : {}),
    ...(paperQuality ? { paperQuality } : {}),
    requiredCommands: Array.from(
      new Set([
        gateCommand,
        ...(researchActivity
          ? [researchActivity.command, researchActivity.fixCommand].filter(Boolean)
          : []),
        ...(paperQuality
          ? [paperQuality.command, ...paperQuality.fixCommands]
          : []),
        ...repairLanes.map((lane) => lane.command),
      ]),
    ),
  };
}

export async function runLaunchTrustContractAudit(
  options: LaunchTrustContractOptions,
): Promise<LaunchTrustContractReport> {
  const [plans, scholarlyActivityAudit, paperQualityAudit] = await Promise.all([
    planStudentVisibilityGate({
      collection: options.collection,
      mode: 'dry-run',
      sourceName: options.sourceName,
      recordIds: options.recordIds,
      limit: options.limit,
    }),
    options.includeResearchActivity ? buildScholarlyActivityAudit() : Promise.resolve(null),
    options.includePaperQuality ? buildPaperQualityAudit(0) : Promise.resolve(null),
  ]);

  const researchActivity = scholarlyActivityAudit
    ? {
        pass: scholarlyActivityAudit.pass,
        counts: { ...scholarlyActivityAudit.counts },
        command: 'yarn --cwd server scholarly-links:provenance-audit --sample-limit=0',
        fixCommand: scholarlyActivityAudit.fixCommand,
      }
    : undefined;
  const paperQuality = paperQualityAudit
    ? {
        pass: paperQualityAudit.pass,
        counts: { ...paperQualityAudit.counts },
        command: 'yarn --cwd server scholarly-links:quality-audit --sample-limit=0',
        fixCommands: paperQualityAudit.fixCommands,
      }
    : undefined;

  return buildLaunchTrustContractReport(plans, {
    collection: options.collection,
    mode: options.mode || 'student-ready-only',
    researchActivity,
    paperQuality,
  });
}
