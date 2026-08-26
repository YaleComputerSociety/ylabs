import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { ResearchEntity } from '../models/researchEntity';
import { RoleAssignment } from '../models/roleAssignment';
import type { ResearchEntityPiDedupeRow } from './researchEntityPiDedupeCore';
import {
  applyResearchEntityDedupeMergeGroup,
  loadSamePiCandidateRows,
} from './dedupeResearchEntitiesByPi';
import {
  applyResearchEntityMergeGroupsWithCanonicalResync,
  selectEponymousFraLabMergeGroups,
} from '../services/researchEntityEponymousMergeService';
import { isCenterOrInstituteEntity } from '../utils/profileAreaDuplicateRisk';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const SCRAPER_SWEEP_AUTO_MERGE_FRA_ENV = 'SCRAPER_SWEEP_AUTO_MERGE_FRA';
export const DEFAULT_EPONYMOUS_FRA_MERGE_MAX = 250;
const DEFAULT_SCOPE_LIMIT = 10000;
const CONFIRM_FLAG = '--confirm-auto-merge-eponymous-fra';
const SCRIPT_NAME = 'research-entity:merge-eponymous-fra';

const FACULTY_RESEARCH_AREA_ENTITY_TYPES = new Set(['FACULTY_RESEARCH_AREA', 'INDIVIDUAL_RESEARCH']);

type ScopeEntity = ResearchEntityPiDedupeRow['entities'][number];

export function isEponymousFraLabMergeStageEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = (env[SCRAPER_SWEEP_AUTO_MERGE_FRA_ENV] || '').trim().toLowerCase();
  return value === '1' || value === 'true';
}

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
  mergedPairs: EponymousFraLabMergePair[];
  visibilityRecomputed: number;
  canonicalEntitiesResynced: number;
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
      row.entities.some((entity) => isCenterOrInstituteEntity(entity)) &&
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
  loadRows?: (options: { sinceIso: string; limit?: number }) => Promise<ResearchEntityPiDedupeRow[]>;
  applyMergeGroup?: (group: { canonicalEntityId: string }) => Promise<{ canonicalEntityId?: string }>;
}

export async function runEponymousFraLabMergeStage(
  options: RunEponymousFraLabMergeStageOptions,
): Promise<EponymousFraLabMergeDelta> {
  const loadRows = options.loadRows ?? loadEponymousFraLabMergeScopeRows;
  const rows = await loadRows({ sinceIso: options.sinceIso, limit: options.limit });
  const { plannedGroups, cappedGroups } = planEponymousFraLabMerges(rows, options.maxMerges);

  let appliedMergeCount = 0;
  let visibilityRecomputed = 0;
  let canonicalEntitiesResynced = 0;
  if (options.apply && cappedGroups.length > 0) {
    const applyMergeGroup =
      options.applyMergeGroup ??
      ((group) =>
        applyResearchEntityDedupeMergeGroup(group as any, {
          deleteDuplicates: false,
          relinkReferences: true,
        }));
    const result = await applyResearchEntityMergeGroupsWithCanonicalResync(cappedGroups, {
      applyMergeGroup,
    });
    appliedMergeCount = cappedGroups.length;
    visibilityRecomputed = result.visibilityRecomputed;
    canonicalEntitiesResynced = result.canonicalEntitiesResynced;
  }

  return {
    scopedPiCount: rows.length,
    plannedMergeCount: plannedGroups.length,
    appliedMergeCount,
    deferredByCapCount: plannedGroups.length - cappedGroups.length,
    maxMerges: options.maxMerges,
    centerGuardedPiCount: countCenterGuardedPis(rows),
    mergedPairs: buildEponymousFraLabMergePairs(cappedGroups, rows),
    visibilityRecomputed,
    canonicalEntitiesResynced,
  };
}

interface EponymousFraLabMergeStageArgs {
  apply: boolean;
  confirm: boolean;
  sinceIso?: string;
  maxMerges: number;
  output?: string;
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
  await mongoose.connect(process.env.MONGODBURL);
  try {
    const mergeDelta = await runEponymousFraLabMergeStage({
      apply: args.apply,
      maxMerges: args.maxMerges,
      sinceIso: args.sinceIso,
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
