import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { ResearchEntity } from '../models/researchEntity';
import { RoleAssignment } from '../models/roleAssignment';
import { partitionMergeGroupsByDistinctPeopleVerdict } from '../services/distinctPeopleVerdicts';
import type { ResearchEntityPiDedupeRow } from './researchEntityPiDedupeCore';
import {
  applyResearchEntityDedupeMergeGroup,
  loadSamePiCandidateRows,
  previewResearchPlanCarryForMergeGroups,
} from './dedupeResearchEntitiesByPi';
import {
  addResearchPlanCarryReports,
  emptyResearchPlanCarryReport,
  researchPlansThatWouldMove,
  type ResearchPlanCarryReport,
} from '../services/researchPlanMergeCarry';
import {
  applyResearchEntityMergeGroupsWithCanonicalResync,
  selectEponymousFraLabMergeGroups,
} from '../services/researchEntityEponymousMergeService';
import { isOrganizationalHomeEntity } from '../utils/profileAreaDuplicateRisk';
import { buildPinnedCanonicalMergeGroup } from './researchEntityPiDedupeCore';
import {
  loadWitnessedFoldContext,
  selectWitnessedFraLabFolds,
  type BallotFoldPair,
  type FoldRefusal,
  type WitnessedFold,
  type WitnessedFoldContext,
} from '../services/witnessedFraLabFold';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { connectScriptMongo } from '../db/connections';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

export const SCRAPER_SWEEP_AUTO_MERGE_FRA_ENV = 'SCRAPER_SWEEP_AUTO_MERGE_FRA';
export const DEFAULT_EPONYMOUS_FRA_MERGE_MAX = 250;
const DEFAULT_SCOPE_LIMIT = 10000;
const CONFIRM_FLAG = '--confirm-auto-merge-eponymous-fra';
const SCRIPT_NAME = 'research-entity:merge-eponymous-fra';

const FACULTY_RESEARCH_AREA_ENTITY_TYPES = new Set([
  'FACULTY_RESEARCH_AREA',
  'INDIVIDUAL_RESEARCH',
]);

type ScopeEntity = ResearchEntityPiDedupeRow['entities'][number];

function isFacultyResearchAreaShellEntity(entity: ScopeEntity): boolean {
  if ((entity.slug || '').toLowerCase().startsWith('faculty-research-area-')) return true;
  return FACULTY_RESEARCH_AREA_ENTITY_TYPES.has((entity.entityType || '').toUpperCase());
}

export interface EponymousFraLabMergePair {
  piUserId: string;
  fraEntityId: string;
  fraSlug: string;
  labEntityId: string;
  labSlug: string;
}

export interface EponymousFraLabMergeDelta {
  scopedPiCount: number;
  plannedMergeCount: number;
  appliedMergeCount: number;
  deferredByCapCount: number;
  maxMerges: number;
  centerGuardedPiCount: number;
  refusedAsDistinctPeopleCount: number;
  mergedPairs: EponymousFraLabMergePair[];
  visibilityRecomputed: number;
  canonicalEntitiesResynced: number;
  canonicalIndexSyncFailures: number;
  researchPlanCarry: ResearchPlanCarryReport;
  researchPlansThatWouldMove: number;
  witnessedFolds: WitnessedFold[];
  witnessedFoldRefusals: FoldRefusal[];
}

function scopeEntitiesById(rows: ResearchEntityPiDedupeRow[]): Map<string, ScopeEntity> {
  const byId = new Map<string, ScopeEntity>();
  for (const row of rows) {
    for (const entity of row.entities) {
      if (entity.id && !byId.has(entity.id)) byId.set(entity.id, entity);
    }
  }
  return byId;
}

export function buildEponymousFraLabMergePairs(
  groups: Array<{
    userId: string;
    canonicalEntityId: string;
    canonicalSlug?: string;
    duplicateEntityIds: string[];
  }>,
  rows: ResearchEntityPiDedupeRow[],
): EponymousFraLabMergePair[] {
  const entitiesById = scopeEntitiesById(rows);
  const pairs: EponymousFraLabMergePair[] = [];
  for (const group of groups) {
    const lab = entitiesById.get(group.canonicalEntityId);
    const labSlug = group.canonicalSlug || lab?.slug || group.canonicalEntityId;
    for (const fraEntityId of group.duplicateEntityIds) {
      const fra = entitiesById.get(fraEntityId);
      pairs.push({
        piUserId: group.userId,
        fraEntityId,
        fraSlug: fra?.slug || fraEntityId,
        labEntityId: group.canonicalEntityId,
        labSlug,
      });
    }
  }
  return pairs;
}

/**
 * Observability counter for the center-guard: a same-PI scope row that carries an
 * eponymous FRA shell and a CENTER/INSTITUTE the professor merely belongs to, yet
 * produces no selected merge, is a case the service refused rather than folding the
 * FRA into an org (issue #1957).
 */
export function countCenterGuardedPis(rows: ResearchEntityPiDedupeRow[]): number {
  return rows.filter(
    (row) =>
      row.entities.some(isFacultyResearchAreaShellEntity) &&
      row.entities.some((entity) => isOrganizationalHomeEntity(entity)) &&
      selectEponymousFraLabMergeGroups([row]).length === 0,
  ).length;
}

export function planEponymousFraLabMerges(
  rows: ResearchEntityPiDedupeRow[],
  maxMerges: number,
): {
  plannedGroups: ReturnType<typeof selectEponymousFraLabMergeGroups>;
  cappedGroups: ReturnType<typeof selectEponymousFraLabMergeGroups>;
} {
  const plannedGroups = selectEponymousFraLabMergeGroups(rows);
  const cappedGroups = plannedGroups.slice(0, Math.max(0, maxMerges));
  return { plannedGroups, cappedGroups };
}

async function loadAffectedPiIdsSince(sinceIso: string): Promise<mongoose.Types.ObjectId[]> {
  const since = new Date(sinceIso);
  if (Number.isNaN(since.getTime())) {
    throw new Error('--since must be a valid ISO timestamp');
  }
  const affectedEntityIds = await ResearchEntity.find({
    archived: { $ne: true },
    lastObservedAt: { $gte: since },
  }).distinct('_id');
  if (affectedEntityIds.length === 0) return [];
  return RoleAssignment.find({
    'target.kind': 'RESEARCH_ENTITY',
    role: 'PI',
    'target.id': { $in: affectedEntityIds },
    state: { $ne: 'HISTORICAL' },
    archived: { $ne: true },
    personId: { $exists: true, $ne: null },
  }).distinct('personId');
}

export async function loadEponymousFraLabMergeScopeRows(options: {
  sinceIso: string;
  limit?: number;
}): Promise<ResearchEntityPiDedupeRow[]> {
  const personIds = await loadAffectedPiIdsSince(options.sinceIso);
  if (personIds.length === 0) return [];
  return loadSamePiCandidateRows(options.limit ?? DEFAULT_SCOPE_LIMIT, {
    includeRetiredMembers: false,
    personIds,
  });
}

export interface RunEponymousFraLabMergeStageOptions {
  apply: boolean;
  maxMerges: number;
  sinceIso: string;
  limit?: number;
  loadRows?: (options: {
    sinceIso: string;
    limit?: number;
  }) => Promise<ResearchEntityPiDedupeRow[]>;
  applyMergeGroup?: (group: {
    canonicalEntityId: string;
  }) => Promise<{ canonicalEntityId?: string; researchPlanCarry?: ResearchPlanCarryReport }>;
  previewResearchPlanCarry?: typeof previewResearchPlanCarryForMergeGroups;
  partitionByDistinctPeople?: typeof partitionMergeGroupsByDistinctPeopleVerdict;
  ballotPairs?: readonly BallotFoldPair[];
  loadWitnessContext?: (input: {
    personIds: readonly string[];
    ballotPairs?: readonly BallotFoldPair[];
  }) => Promise<WitnessedFoldContext>;
}

/**
 * The witnessed folds of a faculty research row into its lead's own lab, as merge groups
 * built from that lead's scope row. A fold whose row the lead's scope does not hold, or that
 * touches a row an eponymous group already plans, is left out.
 */
async function witnessedFoldGroups(
  rows: ResearchEntityPiDedupeRow[],
  eponymousGroups: ReturnType<typeof selectEponymousFraLabMergeGroups>,
  options: RunEponymousFraLabMergeStageOptions,
): Promise<{
  groups: ReturnType<typeof selectEponymousFraLabMergeGroups>;
  folds: WitnessedFold[];
  refusals: FoldRefusal[];
}> {
  const context = await (options.loadWitnessContext ?? loadWitnessedFoldContext)({
    personIds: rows.map((row) => row.userId),
    ballotPairs: options.ballotPairs,
  });
  const { folds, refusals } = selectWitnessedFraLabFolds({
    entities: context.entities,
    edges: context.edges,
    ballotPairs: options.ballotPairs,
  });
  const planned = new Set(
    eponymousGroups.flatMap((group) => [group.canonicalEntityId, ...group.duplicateEntityIds]),
  );
  const asScopeEntity = (id: string) => {
    const entity = context.entities.get(id);
    return entity
      ? {
          id,
          slug: entity.slug,
          name: entity.name,
          kind: entity.kind,
          entityType: entity.entityType,
          ...(entity.mergeFields ?? {}),
        }
      : null;
  };
  const groups: ReturnType<typeof selectEponymousFraLabMergeGroups> = [];
  const kept: WitnessedFold[] = [];
  for (const fold of folds) {
    if (planned.has(fold.facultyRowId) || planned.has(fold.labId)) continue;
    const lab = asScopeEntity(fold.labId);
    const facultyRow = asScopeEntity(fold.facultyRowId);
    if (!lab || !facultyRow) continue;
    const group = buildPinnedCanonicalMergeGroup(
      {
        userId: fold.personId,
        normalizedName: `same-pi:${fold.personId}`,
        entities: [lab, facultyRow] as ResearchEntityPiDedupeRow['entities'],
      },
      fold.labId,
      [fold.facultyRowId],
    );
    if (!group) continue;
    planned.add(fold.facultyRowId);
    planned.add(fold.labId);
    groups.push(group);
    kept.push(fold);
  }
  return { groups, folds: kept, refusals };
}

export async function runEponymousFraLabMergeStage(
  options: RunEponymousFraLabMergeStageOptions,
): Promise<EponymousFraLabMergeDelta> {
  const loadRows = options.loadRows ?? loadEponymousFraLabMergeScopeRows;
  const rows = await loadRows({ sinceIso: options.sinceIso, limit: options.limit });
  const partitionByDistinctPeople =
    options.partitionByDistinctPeople ?? partitionMergeGroupsByDistinctPeopleVerdict;
  const eponymousGroups = selectEponymousFraLabMergeGroups(rows);
  const witnessed = await witnessedFoldGroups(rows, eponymousGroups, options);
  const { kept: plannedGroups, refused: distinctPeopleRefusals } = await partitionByDistinctPeople([
    ...eponymousGroups,
    ...witnessed.groups,
  ]);
  const cappedGroups = plannedGroups.slice(0, Math.max(0, options.maxMerges));

  let appliedMergeCount = 0;
  let visibilityRecomputed = 0;
  let canonicalEntitiesResynced = 0;
  let canonicalIndexSyncFailures = 0;
  let researchPlanCarry = emptyResearchPlanCarryReport();
  if (!options.apply) {
    const previewResearchPlanCarry =
      options.previewResearchPlanCarry ?? previewResearchPlanCarryForMergeGroups;
    researchPlanCarry = await previewResearchPlanCarry(cappedGroups);
  }
  if (options.apply && cappedGroups.length > 0) {
    const applyMergeGroup =
      options.applyMergeGroup ??
      ((group) =>
        applyResearchEntityDedupeMergeGroup(group as any, {
          deleteDuplicates: false,
          relinkReferences: true,
          redirectReason: 'eponymous_fra_lab_merge',
        }));
    const result = await applyResearchEntityMergeGroupsWithCanonicalResync(cappedGroups, {
      applyMergeGroup,
    });
    appliedMergeCount = cappedGroups.length;
    visibilityRecomputed = result.visibilityRecomputed;
    canonicalEntitiesResynced = result.canonicalEntitiesResynced;
    canonicalIndexSyncFailures = result.canonicalIndexSyncFailures;
    researchPlanCarry = result.applied.reduce(
      (total, applied) =>
        applied.researchPlanCarry
          ? addResearchPlanCarryReports(total, applied.researchPlanCarry)
          : total,
      researchPlanCarry,
    );
  }

  return {
    scopedPiCount: rows.length,
    plannedMergeCount: plannedGroups.length,
    appliedMergeCount,
    deferredByCapCount: plannedGroups.length - cappedGroups.length,
    refusedAsDistinctPeopleCount: distinctPeopleRefusals.length,
    maxMerges: options.maxMerges,
    centerGuardedPiCount: countCenterGuardedPis(rows),
    mergedPairs: buildEponymousFraLabMergePairs(cappedGroups, rows),
    visibilityRecomputed,
    canonicalEntitiesResynced,
    canonicalIndexSyncFailures,
    researchPlanCarry,
    researchPlansThatWouldMove: researchPlansThatWouldMove(researchPlanCarry),
    witnessedFolds: witnessed.folds,
    witnessedFoldRefusals: witnessed.refusals,
  };
}

interface EponymousFraLabMergeStageArgs {
  apply: boolean;
  confirm: boolean;
  sinceIso?: string;
  maxMerges: number;
  output?: string;
  ballotPairsFile?: string;
}

export function parseEponymousFraLabMergeStageArgs(argv: string[]): EponymousFraLabMergeStageArgs {
  const args: EponymousFraLabMergeStageArgs = {
    apply: false,
    confirm: false,
    maxMerges: DEFAULT_EPONYMOUS_FRA_MERGE_MAX,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--apply') {
      args.apply = true;
      continue;
    }
    if (arg === '--dry-run' || arg === '--mode=dry-run') {
      args.apply = false;
      continue;
    }
    if (arg === CONFIRM_FLAG) {
      args.confirm = true;
      continue;
    }
    if (arg.startsWith('--since=')) {
      args.sinceIso = arg.slice('--since='.length).trim();
      continue;
    }
    if (arg === '--since') {
      args.sinceIso = (argv[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (arg.startsWith('--max-merges=')) {
      args.maxMerges = parseMaxMerges(arg.slice('--max-merges='.length).trim());
      continue;
    }
    if (arg === '--max-merges') {
      args.maxMerges = parseMaxMerges((argv[index + 1] || '').trim());
      index += 1;
      continue;
    }
    if (arg.startsWith('--ballot-pairs=')) {
      args.ballotPairsFile = arg.slice('--ballot-pairs='.length).trim();
      continue;
    }
    if (arg === '--ballot-pairs') {
      args.ballotPairsFile = (argv[index + 1] || '').trim();
      index += 1;
      continue;
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
    throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  return args;
}

/**
 * The ballot-confirmed pairs an operator supplies: a JSON array of
 * `{ label, facultyRowId, labId }`. The label is the ballot's own neutral label and the
 * recorded evidence for the fold; a pair without both ids is refused rather than skipped.
 */
export function parseBallotFoldPairs(raw: unknown): BallotFoldPair[] {
  if (!Array.isArray(raw)) throw new Error('--ballot-pairs must hold a JSON array');
  return raw.map((entry, index) => {
    const pair = (entry ?? {}) as Record<string, unknown>;
    const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
    const label = text(pair.label);
    const facultyRowId = text(pair.facultyRowId);
    const labId = text(pair.labId);
    if (!label || !facultyRowId || !labId) {
      throw new Error(`--ballot-pairs entry ${index} needs label, facultyRowId and labId`);
    }
    return { label, facultyRowId, labId };
  });
}

function parseMaxMerges(raw: string): number {
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error('--max-merges must be a non-negative integer');
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error('--max-merges must be a non-negative integer');
  }
  return value;
}

async function main(): Promise<void> {
  const args = parseEponymousFraLabMergeStageArgs(process.argv.slice(2));
  if (!args.sinceIso) throw new Error('--since is required');
  if (args.apply && !args.confirm) {
    throw new Error(`${CONFIRM_FLAG} is required when --apply is set for ${SCRIPT_NAME}.`);
  }
  if (!process.env.MONGODBURL) throw new Error('MONGODBURL is required');
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  await connectScriptMongo(process.env.MONGODBURL);
  try {
    const mergeDelta = await runEponymousFraLabMergeStage({
      apply: args.apply,
      maxMerges: args.maxMerges,
      sinceIso: args.sinceIso,
      ballotPairs: args.ballotPairsFile
        ? parseBallotFoldPairs(JSON.parse(fs.readFileSync(args.ballotPairsFile, 'utf8')))
        : undefined,
    });
    const report = {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      mode: args.apply ? 'apply' : 'dry-run',
      since: args.sinceIso,
      mergeDelta,
    };
    console.log(JSON.stringify(report, null, 2));
    if (args.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(args.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exitCode = 1;
  });
}
