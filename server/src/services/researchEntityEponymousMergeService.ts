import mongoose from 'mongoose';
import { ResearchEntity } from '../models/researchEntity';
import {
  buildResearchEntityPiDedupePlan,
  type ResearchEntityPiDedupeGroup,
  type ResearchEntityPiDedupeRow,
} from '../scripts/researchEntityPiDedupeCore';
import { isCenterOrInstituteEntity } from '../utils/profileAreaDuplicateRisk';
import { runStudentVisibilityGate } from './studentVisibilityGateService';
import { syncEntities } from './meiliSyncService';

export interface EponymousFraLabMergeScope {
  rows: ResearchEntityPiDedupeRow[];
}

type ScopeEntity = ResearchEntityPiDedupeRow['entities'][number];

function scopeEntitiesById(rows: ResearchEntityPiDedupeRow[]): Map<string, ScopeEntity> {
  const byId = new Map<string, ScopeEntity>();
  for (const row of rows) {
    for (const entity of row.entities) {
      if (entity.id && !byId.has(entity.id)) byId.set(entity.id, entity);
    }
  }
  return byId;
}

function isFacultyResearchAreaShellSlug(slug: string | undefined): boolean {
  return (slug || '').toLowerCase().startsWith('faculty-research-area-');
}

const FACULTY_RESEARCH_AREA_ENTITY_TYPES = new Set(['FACULTY_RESEARCH_AREA', 'INDIVIDUAL_RESEARCH']);

function isFacultyResearchAreaShellEntity(entity: ScopeEntity | undefined): boolean {
  if (!entity) return false;
  if (isFacultyResearchAreaShellSlug(entity.slug)) return true;
  return FACULTY_RESEARCH_AREA_ENTITY_TYPES.has((entity.entityType || '').toUpperCase());
}

function groupShadowsFacultyResearchArea(
  group: ResearchEntityPiDedupeGroup,
  entitiesById: Map<string, ScopeEntity>,
): boolean {
  if (group.duplicateSlugs.some(isFacultyResearchAreaShellSlug)) return true;
  return group.duplicateEntityIds.some((id) =>
    isFacultyResearchAreaShellEntity(entitiesById.get(id)),
  );
}

/**
 * Filters the same-PI dedupe plan down to the high-confidence eponymous subset only: a
 * `faculty-research-area-*` shell (or individual-entity-type FRA) that shadows the SAME PI's own
 * concrete lab home. Name-only / cross-PI ambiguous clusters (the generic lane, which carries no
 * `profile_area_shell_with_concrete_home` category) are never auto-selected here, and a CENTER or
 * INSTITUTE canonical is refused so an FRA can never be merged into an org the professor merely
 * belongs to (issue #1957).
 */
export function selectEponymousFraLabMergeGroups(
  rows: ResearchEntityPiDedupeRow[],
): ResearchEntityPiDedupeGroup[] {
  const entitiesById = scopeEntitiesById(rows);
  return buildResearchEntityPiDedupePlan(rows).filter((group) => {
    if (group.dedupeCategory !== 'profile_area_shell_with_concrete_home') return false;
    if (!groupShadowsFacultyResearchArea(group, entitiesById)) return false;
    const canonical = entitiesById.get(group.canonicalEntityId);
    if (canonical && isCenterOrInstituteEntity(canonical)) return false;
    return true;
  });
}

export interface AppliedMergeResult {
  canonicalEntityId?: string;
  [key: string]: unknown;
}

function uniqueCanonicalIds(results: AppliedMergeResult[]): string[] {
  return Array.from(
    new Set(
      results
        .map((result) => result?.canonicalEntityId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  );
}

export async function recomputeCanonicalVisibility(canonicalEntityIds: string[]): Promise<number> {
  if (canonicalEntityIds.length === 0) return 0;
  const gateResult = await runStudentVisibilityGate({
    collection: 'research',
    mode: 'apply',
    recordIds: canonicalEntityIds,
  });
  return gateResult.counts.scanned;
}

const CANONICAL_RESYNC_CHUNK_SIZE = 500;

/**
 * Forces an unconditional Meilisearch re-sync of surviving canonical entities after a merge. The
 * visibility gate only re-indexes records whose tier or version changed, so a canonical lab that
 * absorbs a member without a tier change would otherwise keep stale member/lead names in the index
 * (studentVisibilityGateService only syncs materially-changed plans). Re-syncing here guarantees the
 * surviving lab's search document reflects the relinked members regardless of any tier change.
 */
export async function forceResyncCanonicalResearchEntities(
  canonicalEntityIds: string[],
): Promise<number> {
  const objectIds = canonicalEntityIds
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  if (objectIds.length === 0) return 0;
  let resynced = 0;
  for (let start = 0; start < objectIds.length; start += CANONICAL_RESYNC_CHUNK_SIZE) {
    const batch = objectIds.slice(start, start + CANONICAL_RESYNC_CHUNK_SIZE);
    const docs = await ResearchEntity.find({ _id: { $in: batch }, archived: { $ne: true } }).lean();
    if (docs.length > 0) {
      await syncEntities('researchEntity', docs as any);
      resynced += docs.length;
    }
  }
  return resynced;
}

export interface CanonicalRepairResult {
  visibilityRecomputed: number;
  canonicalEntitiesResynced: number;
}

export interface CanonicalRepairHooks {
  recomputeVisibility?: (canonicalEntityIds: string[]) => Promise<number>;
  resyncCanonicalEntities?: (canonicalEntityIds: string[]) => Promise<number>;
}

/**
 * The single post-merge canonical repair path shared by the CLI and the eponymous merge service.
 * Recomputes the surviving canonical entities' student-visibility tier, then forces a Meilisearch
 * re-sync of those canonicals so their member/lead names refresh even when the tier did not change.
 */
export async function recomputeVisibilityAndResyncCanonicals(
  canonicalEntityIds: string[],
  hooks: CanonicalRepairHooks = {},
): Promise<CanonicalRepairResult> {
  const recomputeVisibility = hooks.recomputeVisibility ?? recomputeCanonicalVisibility;
  const resyncCanonicalEntities =
    hooks.resyncCanonicalEntities ?? forceResyncCanonicalResearchEntities;
  const visibilityRecomputed = await recomputeVisibility(canonicalEntityIds);
  const canonicalEntitiesResynced = await resyncCanonicalEntities(canonicalEntityIds);
  return { visibilityRecomputed, canonicalEntitiesResynced };
}

export interface ApplyMergeGroupsWithResyncOptions<TGroup, TResult extends AppliedMergeResult>
  extends CanonicalRepairHooks {
  applyMergeGroup: (group: TGroup) => Promise<TResult>;
}

export interface ApplyMergeGroupsWithResyncResult<TResult extends AppliedMergeResult>
  extends CanonicalRepairResult {
  applied: TResult[];
  canonicalEntityIds: string[];
}

/**
 * Applies a set of merge groups sequentially through the injected merge primitive (reused, never
 * reimplemented here), then runs the shared post-merge canonical repair (visibility recompute plus
 * forced Meilisearch re-sync). Sequential application preserves the CLI's existing ordering so a
 * canonical touched by an earlier group is fully settled before a later group references it.
 */
export async function applyResearchEntityMergeGroupsWithCanonicalResync<
  TGroup extends { canonicalEntityId: string },
  TResult extends AppliedMergeResult,
>(
  groups: TGroup[],
  options: ApplyMergeGroupsWithResyncOptions<TGroup, TResult>,
): Promise<ApplyMergeGroupsWithResyncResult<TResult>> {
  const applied: TResult[] = [];
  for (const group of groups) {
    applied.push(await options.applyMergeGroup(group));
  }
  const canonicalEntityIds = uniqueCanonicalIds(applied);
  const repair = await recomputeVisibilityAndResyncCanonicals(canonicalEntityIds, options);
  return { applied, canonicalEntityIds, ...repair };
}

export interface RunEponymousFraLabMergeOptions<TResult extends AppliedMergeResult>
  extends CanonicalRepairHooks {
  apply: boolean;
  applyMergeGroup: (group: ResearchEntityPiDedupeGroup) => Promise<TResult>;
}

export interface RunEponymousFraLabMergeResult<TResult extends AppliedMergeResult> {
  groups: ResearchEntityPiDedupeGroup[];
  applied: TResult[];
  canonicalEntityIds: string[];
  visibilityRecomputed: number;
  canonicalEntitiesResynced: number;
}

/**
 * Builds the eponymous FRA->lab merge plan for a resolved scope and, when apply is requested,
 * applies it through the shared merge + canonical-repair path. This is the reusable seam a future
 * pipeline stage will call (issue #1957); it does not auto-run and is not wired into any pipeline.
 */
export async function runEponymousFraLabMerge<TResult extends AppliedMergeResult>(
  scope: EponymousFraLabMergeScope,
  options: RunEponymousFraLabMergeOptions<TResult>,
): Promise<RunEponymousFraLabMergeResult<TResult>> {
  const groups = selectEponymousFraLabMergeGroups(scope.rows);
  if (!options.apply || groups.length === 0) {
    return {
      groups,
      applied: [],
      canonicalEntityIds: [],
      visibilityRecomputed: 0,
      canonicalEntitiesResynced: 0,
    };
  }
  const result = await applyResearchEntityMergeGroupsWithCanonicalResync(groups, {
    applyMergeGroup: options.applyMergeGroup,
    recomputeVisibility: options.recomputeVisibility,
    resyncCanonicalEntities: options.resyncCanonicalEntities,
  });
  return { groups, ...result };
}
