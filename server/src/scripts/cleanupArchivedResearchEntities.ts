import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { RESEARCH_ENTITY_SEARCH_INDEX_NAME } from '../services/researchEntitySearchIndexService';
import { getMeiliIndex } from '../utils/meiliClient';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  buildArchivedResearchEntityCleanupPlan,
  type ArchivedEntityLiveReference,
  type ArchivedResearchEntityCandidate,
  type ArchivedResearchEntityCleanupPlan,
} from './cleanupArchivedResearchEntitiesCore';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const CLEANUP_OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const BLOCKED_SAMPLE_LIMIT = 50;
const ELIGIBLE_SAMPLE_LIMIT = 50;
const RESEARCH_ENTITY_REDIRECTS_COLLECTION = 'research_entity_redirects';

export const SCRAPER_SWEEP_DELETE_MERGE_RESIDUE_ENV = 'SCRAPER_SWEEP_DELETE_MERGE_RESIDUE';

export function isMergeResidueDeletionStageEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = (env[SCRAPER_SWEEP_DELETE_MERGE_RESIDUE_ENV] || '').trim().toLowerCase();
  return value === '1' || value === 'true';
}

interface LiveReferenceSpec {
  collection: string;
  field: string;
  filter?: Record<string, unknown>;
}

const LIVE_REFERENCE_SPECS: LiveReferenceSpec[] = [
  {
    collection: 'research_entity_members',
    field: 'researchEntityId',
    filter: { isCurrentMember: { $ne: false } },
  },
  { collection: 'signals', field: 'researchEntityId', filter: { archived: { $ne: true } } },
  { collection: 'role_assignments', field: 'target.id', filter: { archived: { $ne: true } } },
  {
    collection: 'research_scholarly_links',
    field: 'researchEntityId',
    filter: { archived: { $ne: true } },
  },
  {
    collection: 'research_entity_relationships',
    field: 'sourceResearchEntityId',
    filter: { archived: { $ne: true } },
  },
  {
    collection: 'research_entity_relationships',
    field: 'targetResearchEntityId',
    filter: { archived: { $ne: true } },
  },
  {
    collection: 'research_entities',
    field: 'canonicalGroupId',
    filter: { archived: { $ne: true } },
  },
  {
    collection: 'observations',
    field: 'entityId',
    filter: { entityType: { $in: ['researchEntity', 'researchGroup'] } },
  },
];

const DEPENDENT_DELETE_COLLECTIONS = [
  'research_entity_members',
  'signals',
  'research_scholarly_links',
];

export interface CleanupArchivedResearchEntitiesCliOptions {
  apply: boolean;
  confirmArchivedEntityCleanup: boolean;
  limit: number;
  limitProvided: boolean;
  maxApply: number;
  mergeResidueOnly: boolean;
  output?: string;
}

function parsePositiveInteger(value: string, optionName: string): number {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${optionName} must be a positive integer`);
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer`);
  }
  return parsed;
}

export function parseCleanupArchivedResearchEntitiesArgs(
  argv: string[],
): CleanupArchivedResearchEntitiesCliOptions {
  const options: CleanupArchivedResearchEntitiesCliOptions = {
    apply: false,
    confirmArchivedEntityCleanup: false,
    limit: 100,
    limitProvided: false,
    maxApply: 25,
    mergeResidueOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--apply' || arg === '--mode=apply') {
      options.apply = true;
      continue;
    }
    if (arg === '--confirm-archived-entity-cleanup') {
      options.confirmArchivedEntityCleanup = true;
      continue;
    }
    if (arg.startsWith('--confirm-archived-entity-cleanup=')) {
      throw new Error('--confirm-archived-entity-cleanup does not accept a value');
    }
    if (arg === '--merge-residue-only') {
      options.mergeResidueOnly = true;
      continue;
    }
    if (arg.startsWith('--merge-residue-only=')) {
      throw new Error('--merge-residue-only does not accept a value');
    }
    if (arg === '--mode=dry-run' || arg === '--dry-run') {
      options.apply = false;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      const limit = arg.slice('--limit='.length).trim();
      if (!limit) throw new Error('--limit requires a number');
      options.limit = parsePositiveInteger(limit, '--limit');
      options.limitProvided = true;
      continue;
    }
    if (arg === '--limit') {
      const limit = argv[index + 1]?.trim();
      if (!limit || limit.startsWith('--')) throw new Error('--limit requires a number');
      options.limit = parsePositiveInteger(limit, '--limit');
      options.limitProvided = true;
      index += 1;
      continue;
    }
    if (arg.startsWith('--max-apply=')) {
      const maxApply = arg.slice('--max-apply='.length).trim();
      if (!maxApply) throw new Error('--max-apply requires a number');
      options.maxApply = parsePositiveInteger(maxApply, '--max-apply');
      continue;
    }
    if (arg === '--max-apply') {
      const maxApply = argv[index + 1]?.trim();
      if (!maxApply || maxApply.startsWith('--')) throw new Error('--max-apply requires a number');
      options.maxApply = parsePositiveInteger(maxApply, '--max-apply');
      index += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
      continue;
    }
    if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[index + 1]);
      index += 1;
      continue;
    }

    throw new Error(`Unknown research-entity:cleanup-archived argument: ${arg}`);
  }

  return options;
}

export function assertCleanupArchivedResearchEntitiesApplyAllowed({
  apply,
  confirmArchivedEntityCleanup,
  limitProvided,
  maxApply,
  plannedDeletes,
}: {
  apply: boolean;
  confirmArchivedEntityCleanup?: boolean;
  limitProvided?: boolean;
  maxApply: number;
  plannedDeletes: number;
}): void {
  if (!apply) return;
  if (limitProvided === false) {
    throw new Error('--limit is required when --apply is set for research-entity:cleanup-archived');
  }
  if (!confirmArchivedEntityCleanup) {
    throw new Error(
      '--confirm-archived-entity-cleanup is required when --apply is set for research-entity:cleanup-archived',
    );
  }
  if (plannedDeletes > maxApply) {
    throw new Error(
      `Apply would delete ${plannedDeletes} archived research entities, above --max-apply.`,
    );
  }
}

export function writeCleanupArchivedResearchEntitiesOutput(
  report: Record<string, unknown>,
  output?: string,
): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

export function buildCleanupArchivedResearchEntitiesOutput(
  target: {
    environment: string;
    db: string;
    options?: CleanupArchivedResearchEntitiesCliOptions;
  },
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

function stringId(value: unknown): string {
  return serializedDocumentId(value) || '';
}

function objectId(value: unknown): mongoose.Types.ObjectId | undefined {
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return CLEANUP_OBJECT_ID_RE.test(trimmed) ? new mongoose.Types.ObjectId(trimmed) : undefined;
}

function referenceMatchValues(ids: string[]): (mongoose.Types.ObjectId | string)[] {
  const values: (mongoose.Types.ObjectId | string)[] = [];
  for (const id of ids) {
    if (!id) continue;
    values.push(id);
    const asObjectId = objectId(id);
    if (asObjectId) values.push(asObjectId);
  }
  return values;
}

function archivedIdReferenceMatchValues(
  archivedEntities: Array<{ _id: unknown }>,
): (mongoose.Types.ObjectId | string)[] {
  return referenceMatchValues(archivedEntities.map((entity) => stringId(entity._id)));
}

async function collectionExists(collectionName: string): Promise<boolean> {
  const db = mongoose.connection.db;
  if (!db) return false;
  const matches = await db.listCollections({ name: collectionName }, { nameOnly: true }).toArray();
  return matches.length > 0;
}

async function loadArchivedResearchEntityCandidates(
  limit: number,
  mergeResidueOnly = false,
): Promise<ArchivedResearchEntityCandidate[]> {
  const query: Record<string, unknown> = { archived: true };
  if (mergeResidueOnly) {
    query.canonicalGroupId = { $exists: true, $ne: null };
  }
  const archivedEntities = await ResearchEntity.find(query)
    .select('_id name slug')
    .limit(limit)
    .lean();
  const db = mongoose.connection.db;
  const references = new Map<string, ArchivedEntityLiveReference[]>();
  for (const entity of archivedEntities) {
    references.set(stringId(entity._id), []);
  }
  const archivedIdMatchValues = archivedIdReferenceMatchValues(archivedEntities);

  if (db && archivedIdMatchValues.length > 0) {
    for (const spec of LIVE_REFERENCE_SPECS) {
      if (!(await collectionExists(spec.collection))) continue;
      const rows = await db
        .collection(spec.collection)
        .aggregate([
          { $match: { ...(spec.filter || {}), [spec.field]: { $in: archivedIdMatchValues } } },
          { $group: { _id: `$${spec.field}`, count: { $sum: 1 } } },
        ])
        .toArray();
      for (const row of rows) {
        const referencedId = stringId(row._id);
        const bucket = references.get(referencedId);
        if (!bucket) continue;
        bucket.push({ collection: spec.collection, field: spec.field, count: row.count || 0 });
      }
    }
  }

  const redirectPresence = mergeResidueOnly
    ? await loadRedirectPresence(archivedEntities, archivedIdMatchValues)
    : undefined;

  return archivedEntities.map((entity: any) => ({
    id: stringId(entity._id),
    ...(entity.name ? { name: String(entity.name) } : {}),
    ...(entity.slug ? { slug: String(entity.slug) } : {}),
    liveReferences: references.get(stringId(entity._id)) || [],
    ...(redirectPresence
      ? { redirectPresent: redirectPresence.has(stringId(entity._id)) }
      : {}),
  }));
}

async function loadRedirectPresence(
  archivedEntities: Array<{ _id: unknown; slug?: unknown }>,
  archivedIdMatchValues: (mongoose.Types.ObjectId | string)[],
): Promise<Set<string>> {
  const withRedirect = new Set<string>();
  const db = mongoose.connection.db;
  if (!db || archivedEntities.length === 0) return withRedirect;
  if (!(await collectionExists(RESEARCH_ENTITY_REDIRECTS_COLLECTION))) return withRedirect;

  const slugByEntityId = new Map<string, string>();
  const slugToEntityIds = new Map<string, string[]>();
  for (const entity of archivedEntities) {
    const id = stringId(entity._id);
    const slug = typeof entity.slug === 'string' ? entity.slug.trim() : '';
    if (!slug) continue;
    slugByEntityId.set(id, slug);
    const bucket = slugToEntityIds.get(slug) || [];
    bucket.push(id);
    slugToEntityIds.set(slug, bucket);
  }

  const redirectRows = await db
    .collection(RESEARCH_ENTITY_REDIRECTS_COLLECTION)
    .find({
      $or: [
        { mergedEntityId: { $in: archivedIdMatchValues } },
        ...(slugToEntityIds.size > 0 ? [{ mergedSlug: { $in: [...slugToEntityIds.keys()] } }] : []),
      ],
    })
    .project({ mergedEntityId: 1, mergedSlug: 1 })
    .toArray();

  for (const row of redirectRows) {
    const mergedEntityId = stringId(row.mergedEntityId);
    if (mergedEntityId) withRedirect.add(mergedEntityId);
    const mergedSlug = typeof row.mergedSlug === 'string' ? row.mergedSlug.trim() : '';
    for (const id of slugToEntityIds.get(mergedSlug) || []) withRedirect.add(id);
  }

  return withRedirect;
}

async function deleteDependentArtifacts(eligibleIds: string[]): Promise<Record<string, number>> {
  const db = mongoose.connection.db;
  const deleted: Record<string, number> = {};
  if (!db || eligibleIds.length === 0) return deleted;
  const matchValues = referenceMatchValues(eligibleIds);
  for (const collectionName of DEPENDENT_DELETE_COLLECTIONS) {
    if (!(await collectionExists(collectionName))) continue;
    const result = await db
      .collection(collectionName)
      .deleteMany({ researchEntityId: { $in: matchValues } });
    if (result.deletedCount) deleted[collectionName] = result.deletedCount;
  }
  return deleted;
}

async function deleteResearchEntitySearchDocuments(
  eligibleIds: string[],
  getIndex: typeof getMeiliIndex,
): Promise<{ requested: number; deleted: boolean; error?: string }> {
  if (eligibleIds.length === 0) return { requested: 0, deleted: false };
  try {
    const index = await getIndex(RESEARCH_ENTITY_SEARCH_INDEX_NAME);
    await index.deleteDocuments(eligibleIds);
    return { requested: eligibleIds.length, deleted: true };
  } catch (error) {
    return {
      requested: eligibleIds.length,
      deleted: false,
      error: String(sanitizeLogValue(error)),
    };
  }
}

export interface CleanupArchivedResearchEntitiesResult {
  mode: 'dry-run' | 'apply';
  plan: ArchivedResearchEntityCleanupPlan;
  plannedDeletes: number;
  blockedSample: ArchivedResearchEntityCleanupPlan['blocked'];
  eligibleSample: string[];
  deletedResearchEntities: number;
  deletedDependents: Record<string, number>;
  search: { requested: number; deleted: boolean; error?: string; rebuildGuidance?: string };
}

export async function cleanupArchivedResearchEntities(options: {
  apply: boolean;
  limit: number;
  mergeResidueOnly?: boolean;
  getIndex?: typeof getMeiliIndex;
}): Promise<CleanupArchivedResearchEntitiesResult> {
  const candidates = await loadArchivedResearchEntityCandidates(
    options.limit,
    options.mergeResidueOnly,
  );
  const plan = buildArchivedResearchEntityCleanupPlan({
    candidates,
    requireRedirect: options.mergeResidueOnly === true,
  });

  let deletedResearchEntities = 0;
  let deletedDependents: Record<string, number> = {};
  let search: CleanupArchivedResearchEntitiesResult['search'] = { requested: 0, deleted: false };

  if (options.apply && plan.eligible.length > 0) {
    const eligibleObjectIds = plan.eligible
      .map((id) => objectId(id))
      .filter((id): id is mongoose.Types.ObjectId => Boolean(id));
    deletedDependents = await deleteDependentArtifacts(plan.eligible);
    const deletion = await ResearchEntity.deleteMany({ _id: { $in: eligibleObjectIds } });
    deletedResearchEntities = deletion.deletedCount || 0;
    search = {
      ...(await deleteResearchEntitySearchDocuments(
        plan.eligible,
        options.getIndex || getMeiliIndex,
      )),
      rebuildGuidance:
        'If search documents were not deleted, rebuild with meili:rebuild-research-entities --clear --confirm-meili-rebuild.',
    };
  }

  return {
    mode: options.apply ? 'apply' : 'dry-run',
    plan,
    plannedDeletes: plan.eligibleCount,
    blockedSample: plan.blocked.slice(0, BLOCKED_SAMPLE_LIMIT),
    eligibleSample: plan.eligible.slice(0, ELIGIBLE_SAMPLE_LIMIT),
    deletedResearchEntities,
    deletedDependents,
    search,
  };
}

async function main() {
  const options = parseCleanupArchivedResearchEntitiesArgs(process.argv.slice(2));
  assertCleanupArchivedResearchEntitiesApplyAllowed({
    apply: options.apply,
    confirmArchivedEntityCleanup: options.confirmArchivedEntityCleanup,
    limitProvided: options.limitProvided,
    maxApply: options.maxApply,
    plannedDeletes: 0,
  });
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'research-entity:cleanup-archived',
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();
  const candidates = await loadArchivedResearchEntityCandidates(
    options.limit,
    options.mergeResidueOnly,
  );
  const plan = buildArchivedResearchEntityCleanupPlan({
    candidates,
    requireRedirect: options.mergeResidueOnly === true,
  });
  assertCleanupArchivedResearchEntitiesApplyAllowed({
    apply: options.apply,
    confirmArchivedEntityCleanup: options.confirmArchivedEntityCleanup,
    limitProvided: options.limitProvided,
    maxApply: options.maxApply,
    plannedDeletes: plan.eligibleCount,
  });

  const result = await cleanupArchivedResearchEntities({
    apply: options.apply,
    limit: options.limit,
    mergeResidueOnly: options.mergeResidueOnly,
  });

  const report = buildCleanupArchivedResearchEntitiesOutput(
    {
      environment: guard.environment,
      db: guard.dbLabel,
      options,
    },
    {
      mode: result.mode,
      scanned: result.plan.scanned,
      eligibleCount: result.plan.eligibleCount,
      blockedCount: result.plan.blockedCount,
      deferredByReason: result.plan.deferredByReason,
      plannedDeletes: result.plannedDeletes,
      eligibleSample: result.eligibleSample,
      blockedSample: result.blockedSample,
      deletedResearchEntities: result.deletedResearchEntities,
      deletedDependents: result.deletedDependents,
      search: result.search,
    },
  );
  console.log(JSON.stringify(report, null, 2));
  writeCleanupArchivedResearchEntitiesOutput(report, options.output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error('Failed to clean up archived research entities:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
