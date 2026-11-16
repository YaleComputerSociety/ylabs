/**
 * Holds a center roster apply to the plan its dry run showed (#6348).
 *
 * A center roster run ends role edges in two places: the projection of its listings ends
 * the edges a listing's earlier resolution left behind, and center roster retirement ends
 * the edges two complete reads stop listing. A dry run used to plan retirement against the
 * stored edges while the apply planned it against the edges its own projection had just
 * written, and it showed none of the projection's endings, so an approved dry run was not a
 * description of the apply.
 *
 * In `plan` mode a dry run records every edge the projection would end and each center's
 * retirement digest. In `enforce` mode an apply ends only the projection edges that plan
 * listed and retires a center only when its post-projection digest equals the approved one;
 * everything else is reported and left live.
 */
import { readFile } from 'node:fs/promises';
import mongoose from 'mongoose';
import { LEAD_ROLE_CANONICAL_VALUES } from '../models/canonicalRoleMapping';
import { Observation } from '../models/observation';
import { RoleAssignment } from '../models/roleAssignment';
import { serializedDocumentId } from '../utils/idSerialization';
import {
  CENTER_ROSTER_HEALTH_ENTITY_TYPE,
  type CenterRosterRetirementDigest,
  type CenterRosterRetirementResult,
} from './centerRosterRetirement';
import type { ScraperEnvironment } from './scraperEnvironment';

export type CenterPlanGuardMode = 'plan' | 'enforce';

export interface CenterPlanProjectionEnding {
  centerEntityKey: string;
  edgeId: string;
  role: string;
  lead: boolean;
  reason: string;
}

export interface CenterPlanGuard {
  mode: CenterPlanGuardMode;
  /** Center entity key to the edge ids its projection may end. */
  approvedProjectionEndings: ReadonlyMap<string, ReadonlySet<string>>;
  /** Lane source name to center entity key to the approved retirement digest. */
  approvedRetirementDigests: ReadonlyMap<string, ReadonlyMap<string, CenterRosterRetirementDigest>>;
  plannedProjectionEndings: CenterPlanProjectionEnding[];
  endedProjectionEndings: CenterPlanProjectionEnding[];
  skippedProjectionEndings: CenterPlanProjectionEnding[];
}

export interface RosterEdgeEndingContext {
  guard: CenterPlanGuard;
  centerEntityKey: string;
}

export function newCenterPlanGuard(
  mode: CenterPlanGuardMode,
  approvals: Pick<CenterPlanGuard, 'approvedProjectionEndings' | 'approvedRetirementDigests'> = {
    approvedProjectionEndings: new Map(),
    approvedRetirementDigests: new Map(),
  },
): CenterPlanGuard {
  return {
    mode,
    approvedProjectionEndings: approvals.approvedProjectionEndings,
    approvedRetirementDigests: approvals.approvedRetirementDigests,
    plannedProjectionEndings: [],
    endedProjectionEndings: [],
    skippedProjectionEndings: [],
  };
}

const LEAD_ROLES: ReadonlySet<string> = new Set(LEAD_ROLE_CANONICAL_VALUES);

const recordOnce = (
  records: CenterPlanProjectionEnding[],
  record: CenterPlanProjectionEnding,
): void => {
  if (
    records.some(
      (existing) =>
        existing.centerEntityKey === record.centerEntityKey &&
        existing.edgeId === record.edgeId &&
        existing.reason === record.reason,
    )
  ) {
    return;
  }
  records.push(record);
};

/**
 * The one path by which a roster listing's projection ends role edges. Without a context it is
 * the plain `updateMany` every non-center lane has always run. With one it plans the endings or
 * holds them to the approved plan, and never ends an edge whose id the plan did not list, a
 * lead edge included.
 */
export async function endRosterListingEdges(
  filter: Record<string, unknown>,
  set: Record<string, unknown>,
  reason: string,
  context?: RosterEdgeEndingContext,
): Promise<number> {
  if (!context) {
    const ended = await RoleAssignment.updateMany(filter, { $set: set });
    return ended.modifiedCount ?? 0;
  }
  const { guard, centerEntityKey } = context;
  const matches = (await RoleAssignment.find(filter).select('_id role').lean()) as Array<{
    _id?: unknown;
    role?: unknown;
  }>;
  const records = matches
    .map((row) => {
      const role = typeof row.role === 'string' ? row.role : '';
      return {
        centerEntityKey,
        edgeId: serializedDocumentId(row._id) || '',
        role,
        lead: LEAD_ROLES.has(role),
        reason,
      };
    })
    .filter((record) => record.edgeId);
  if (guard.mode === 'plan') {
    for (const record of records) recordOnce(guard.plannedProjectionEndings, record);
    return 0;
  }
  const approved = guard.approvedProjectionEndings.get(centerEntityKey);
  const approvedRecords = records.filter((record) => approved?.has(record.edgeId));
  for (const record of records) {
    if (!approved?.has(record.edgeId)) recordOnce(guard.skippedProjectionEndings, record);
  }
  if (approvedRecords.length === 0) return 0;
  const ended = await RoleAssignment.updateMany(
    {
      ...filter,
      _id: { $in: approvedRecords.map((record) => new mongoose.Types.ObjectId(record.edgeId)) },
    },
    { $set: set },
  );
  for (const record of approvedRecords) recordOnce(guard.endedProjectionEndings, record);
  return ended.modifiedCount ?? 0;
}

export interface CenterPlanRetirementEntry {
  lane: string;
  digest: CenterRosterRetirementDigest;
  planDiverged?: true;
}

export interface CenterPlanCenterEntry {
  entityKey: string;
  retirement: CenterPlanRetirementEntry[];
  projectionEndings: Array<Omit<CenterPlanProjectionEnding, 'centerEntityKey'>>;
  skippedProjectionEndings?: Array<Omit<CenterPlanProjectionEnding, 'centerEntityKey'>>;
}

/**
 * The `centerPlan` section of a materialize report. A dry run writes it in `plan` mode, and its
 * `projectionEndings` are what an apply may end; an apply writes it in `enforce` mode, where
 * `projectionEndings` are what it ended and the skipped endings and diverged centers are what
 * it refused.
 */
export interface CenterPlanReport {
  mode: CenterPlanGuardMode;
  runId: string;
  centers: CenterPlanCenterEntry[];
}

const withoutCenterKey = ({
  centerEntityKey: _centerEntityKey,
  ...ending
}: CenterPlanProjectionEnding): Omit<CenterPlanProjectionEnding, 'centerEntityKey'> => ending;

const byEdgeThenReason = (
  left: { edgeId: string; reason: string },
  right: { edgeId: string; reason: string },
) => left.edgeId.localeCompare(right.edgeId) || left.reason.localeCompare(right.reason);

export function buildCenterPlanReport(
  runId: string,
  guard: CenterPlanGuard,
  retirements: ReadonlyArray<{ lane: string; result: CenterRosterRetirementResult }>,
): CenterPlanReport {
  const centers = new Map<string, CenterPlanCenterEntry>();
  const centerFor = (entityKey: string): CenterPlanCenterEntry => {
    let entry = centers.get(entityKey);
    if (!entry) {
      entry = { entityKey, retirement: [], projectionEndings: [] };
      centers.set(entityKey, entry);
    }
    return entry;
  };
  for (const { lane, result } of retirements) {
    for (const center of result.centers) {
      if (!center.digest) continue;
      centerFor(center.entityKey).retirement.push({
        lane,
        digest: center.digest,
        ...(center.planDiverged ? { planDiverged: true as const } : {}),
      });
    }
  }
  const endings =
    guard.mode === 'plan' ? guard.plannedProjectionEndings : guard.endedProjectionEndings;
  for (const ending of endings) {
    centerFor(ending.centerEntityKey).projectionEndings.push(withoutCenterKey(ending));
  }
  if (guard.mode === 'enforce') {
    for (const ending of guard.skippedProjectionEndings) {
      const entry = centerFor(ending.centerEntityKey);
      entry.skippedProjectionEndings = [
        ...(entry.skippedProjectionEndings ?? []),
        withoutCenterKey(ending),
      ];
    }
  }
  return {
    mode: guard.mode,
    runId,
    centers: [...centers.values()]
      .map((entry) => ({
        ...entry,
        retirement: [...entry.retirement].sort((left, right) =>
          left.lane.localeCompare(right.lane),
        ),
        projectionEndings: [...entry.projectionEndings].sort(byEdgeThenReason),
        ...(entry.skippedProjectionEndings
          ? { skippedProjectionEndings: [...entry.skippedProjectionEndings].sort(byEdgeThenReason) }
          : {}),
      }))
      .sort((left, right) => left.entityKey.localeCompare(right.entityKey)),
  };
}

/**
 * The exit code of an enforced apply that held anything back. Distinct from 1 (failed) and from
 * 3 (`SCRIPT_EXIT_HELD_OPEN`) so a caller can tell "the approved part landed, the rest needs a
 * new plan" from a failure.
 */
export const CENTER_PLAN_HELD_BACK_EXIT_CODE = 4;

export function centerPlanHeldBack(report: CenterPlanReport | undefined): {
  divergedCenters: number;
  skippedProjectionEndings: number;
} {
  const centers = report?.mode === 'enforce' ? report.centers : [];
  return {
    divergedCenters: centers.filter((center) =>
      center.retirement.some((entry) => entry.planDiverged),
    ).length,
    skippedProjectionEndings: centers.reduce(
      (total, center) => total + (center.skippedProjectionEndings?.length ?? 0),
      0,
    ),
  };
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

function parseDigest(value: unknown, where: string): CenterRosterRetirementDigest {
  const digest = value as Record<string, unknown> | null;
  if (
    !digest ||
    typeof digest !== 'object' ||
    typeof digest.entityKey !== 'string' ||
    typeof digest.verdict !== 'string' ||
    !(digest.freezeReason === null || typeof digest.freezeReason === 'string') ||
    !isStringArray(digest.retiredEdgeIds) ||
    !isStringArray(digest.protectedLeadEdgeIds)
  ) {
    throw new Error(`${where} is not a center roster retirement digest`);
  }
  return digest as unknown as CenterRosterRetirementDigest;
}

/**
 * Reads the approvals out of a dry run's `centerPlan` section. Anything but a `plan`-mode
 * section of the same run is refused, because an apply held to another run's plan, or to an
 * apply's own report, would be held to a plan nobody approved.
 */
export function approvalsFromCenterPlanReport(
  report: unknown,
  runId: string,
): Pick<CenterPlanGuard, 'approvedProjectionEndings' | 'approvedRetirementDigests'> {
  const plan = report as Record<string, unknown> | null;
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.centers)) {
    throw new Error('--expect-center-plan: the file has no centerPlan section');
  }
  if (plan.mode !== 'plan') {
    throw new Error(
      '--expect-center-plan: the centerPlan section is not from a dry run (its mode is not "plan")',
    );
  }
  if (plan.runId !== runId) {
    throw new Error(
      `--expect-center-plan: the centerPlan section is for run ${String(plan.runId)}, not run ${runId}`,
    );
  }
  const approvedProjectionEndings = new Map<string, Set<string>>();
  const approvedRetirementDigests = new Map<string, Map<string, CenterRosterRetirementDigest>>();
  plan.centers.forEach((value, index) => {
    const center = value as Record<string, unknown> | null;
    const where = `--expect-center-plan: centers[${index}]`;
    if (
      !center ||
      typeof center.entityKey !== 'string' ||
      !Array.isArray(center.retirement) ||
      !Array.isArray(center.projectionEndings)
    ) {
      throw new Error(`${where} is malformed`);
    }
    const entityKey = center.entityKey;
    const edgeIds = approvedProjectionEndings.get(entityKey) ?? new Set<string>();
    for (const ending of center.projectionEndings as unknown[]) {
      const edgeId = (ending as Record<string, unknown> | null)?.edgeId;
      if (typeof edgeId !== 'string' || !edgeId) {
        throw new Error(`${where}.projectionEndings has an entry with no edgeId`);
      }
      edgeIds.add(edgeId);
    }
    approvedProjectionEndings.set(entityKey, edgeIds);
    for (const entry of center.retirement as unknown[]) {
      const retirement = entry as Record<string, unknown> | null;
      if (!retirement || typeof retirement.lane !== 'string') {
        throw new Error(`${where}.retirement has an entry with no lane`);
      }
      const digest = parseDigest(retirement.digest, `${where}.retirement`);
      const byCenter =
        approvedRetirementDigests.get(retirement.lane) ??
        new Map<string, CenterRosterRetirementDigest>();
      byCenter.set(digest.entityKey, digest);
      approvedRetirementDigests.set(retirement.lane, byCenter);
    }
  });
  return { approvedProjectionEndings, approvedRetirementDigests };
}

export async function runContainsCenterRosterHealth(runId: string): Promise<boolean> {
  if (!mongoose.isValidObjectId(runId)) return false;
  return Boolean(
    await Observation.exists({
      scrapeRunId: new mongoose.Types.ObjectId(runId),
      entityType: CENTER_ROSTER_HEALTH_ENTITY_TYPE,
    }),
  );
}

/**
 * Sources whose runs emit `centerRosterHealth` snapshots. A run of one of them is a center roster
 * run, so `scrape run --auto-materialize` on Development is refused before it fetches; the
 * materialize after a run also checks the run's own snapshots, so a source missing here still
 * never auto-materializes a center roster run.
 */
export const CENTER_ROSTER_HEALTH_SOURCE_NAMES: ReadonlySet<string> = new Set([
  'bbs-research-track',
  'center-affiliation-llm',
  'center-affiliation-roster',
  'center-director',
  'center-director-llm',
  'centers-institutes-index',
  'official-profile-pi-backfill',
]);

export const autoMaterializeCenterRosterRefusal = (sourceName: string): string =>
  `${sourceName} writes center roster reads, so a Development "scrape run --auto-materialize" cannot hold its apply to an approved plan: run it without --auto-materialize, then "scrape materialize --run <runId> --dry-run --output <plan.json>", review the centerPlan section, and apply with --expect-center-plan <plan.json> (#6348).`;

export function resolveAutoMaterializeCenterRosterRefusal(input: {
  sourceName: string;
  environment: ScraperEnvironment;
  writes: boolean;
  autoMaterialize: boolean;
}): string | undefined {
  if (!input.writes || !input.autoMaterialize || input.environment !== 'development') {
    return undefined;
  }
  return CENTER_ROSTER_HEALTH_SOURCE_NAMES.has(input.sourceName)
    ? autoMaterializeCenterRosterRefusal(input.sourceName)
    : undefined;
}

export type MaterializeCenterPlanDecision =
  { refusal: string } | { guard?: CenterPlanGuard; refusal?: undefined };

/**
 * Which plan guard a `scrape materialize` runs under. A dry run of a center roster run plans;
 * an apply with `--expect-center-plan` enforces that plan; a Development apply of a center
 * roster run without one is refused before anything is written, `--skip-center-roster-retirement`
 * included, because the projection still ends edges. A field-scoped pass writes only user rows
 * and ends no edge, and every other run is untouched.
 */
export async function resolveMaterializeCenterPlanGuard(
  input: {
    runId: string;
    environment: ScraperEnvironment;
    dryRun: boolean;
    writes: boolean;
    fieldScoped: boolean;
    expectCenterPlanPath?: string;
  },
  deps: {
    runHasCenterRosterHealth?: (runId: string) => Promise<boolean>;
    readPlanFile?: (path: string) => Promise<string>;
  } = {},
): Promise<MaterializeCenterPlanDecision> {
  if (input.fieldScoped) {
    if (input.expectCenterPlanPath) {
      return {
        refusal:
          '--expect-center-plan cannot be combined with --only-fields: a field-scoped pass ends no role edge and retires nothing.',
      };
    }
    return {};
  }
  const hasCenterRosterHealth = deps.runHasCenterRosterHealth ?? runContainsCenterRosterHealth;
  if (input.dryRun) {
    if (input.expectCenterPlanPath) {
      return {
        refusal:
          '--expect-center-plan applies only to an apply; a dry run writes the plan to its --output centerPlan section instead.',
      };
    }
    return (await hasCenterRosterHealth(input.runId)) ? { guard: newCenterPlanGuard('plan') } : {};
  }
  if (input.expectCenterPlanPath) {
    const readPlanFile = deps.readPlanFile ?? ((path: string) => readFile(path, 'utf8'));
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readPlanFile(input.expectCenterPlanPath));
    } catch (error) {
      return {
        refusal: `--expect-center-plan: could not read ${input.expectCenterPlanPath} as JSON (${(error as Error).message})`,
      };
    }
    try {
      const approvals = approvalsFromCenterPlanReport(
        (parsed as Record<string, unknown> | null)?.centerPlan,
        input.runId,
      );
      return { guard: newCenterPlanGuard('enforce', approvals) };
    } catch (error) {
      return { refusal: (error as Error).message };
    }
  }
  if (
    input.writes &&
    input.environment === 'development' &&
    (await hasCenterRosterHealth(input.runId))
  ) {
    return {
      refusal: `Run ${input.runId} holds center roster reads, so a Development apply must be held to an approved plan: run "scrape materialize --run ${input.runId} --dry-run --output <plan.json>", review its centerPlan section, then re-run the apply with --expect-center-plan <plan.json> (#6348). This applies with --skip-center-roster-retirement too, because the projection still ends edges.`,
    };
  }
  return {};
}
