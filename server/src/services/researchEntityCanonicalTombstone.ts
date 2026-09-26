import mongoose from 'mongoose';
import { ResearchEntity } from '../models/researchEntity';

export const MAX_RESEARCH_ENTITY_TOMBSTONE_HOPS = 10;

export interface ResearchEntityTombstoneNode extends Record<string, any> {
  _id: mongoose.Types.ObjectId;
  archived?: boolean;
  canonicalGroupId?: mongoose.Types.ObjectId | null;
}

export type ResearchEntityCanonicalAcceptance = (candidate: ResearchEntityTombstoneNode) => boolean;

const acceptAnyLiveCanonical: ResearchEntityCanonicalAcceptance = (candidate) =>
  candidate.archived !== true;

export interface ResearchEntityTombstoneChainDeps {
  findById: (id: string) => Promise<ResearchEntityTombstoneNode | null>;
  isAcceptableCanonical?: ResearchEntityCanonicalAcceptance;
  maxHops?: number;
}

export async function walkResearchEntityTombstoneChain(
  start: ResearchEntityTombstoneNode,
  deps: ResearchEntityTombstoneChainDeps,
): Promise<ResearchEntityTombstoneNode | null> {
  const maxHops = deps.maxHops ?? MAX_RESEARCH_ENTITY_TOMBSTONE_HOPS;
  const isAcceptableCanonical = deps.isAcceptableCanonical ?? acceptAnyLiveCanonical;
  const visited = new Set<string>([String(start._id)]);
  let nextId = start.canonicalGroupId ? String(start.canonicalGroupId) : null;

  for (let hop = 0; hop < maxHops && nextId; hop += 1) {
    if (visited.has(nextId)) return null;
    visited.add(nextId);
    const candidate = await deps.findById(nextId);
    if (!candidate) return null;
    if (isAcceptableCanonical(candidate)) return candidate;
    nextId = candidate.canonicalGroupId ? String(candidate.canonicalGroupId) : null;
  }

  return null;
}

// findOne rather than findById so the chain hop and the entry lookup share one
// query surface; several callers double the model in tests and a second entry point
// silently returns undefined there.
const findEntityById = async (id: string): Promise<ResearchEntityTombstoneNode | null> => {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return (await ResearchEntity.findOne({
    _id: new mongoose.Types.ObjectId(id),
  }).lean()) as ResearchEntityTombstoneNode | null;
};

export async function resolveResearchEntityCanonicalByTombstone(
  shell: ResearchEntityTombstoneNode,
): Promise<ResearchEntityTombstoneNode | null> {
  return walkResearchEntityTombstoneChain(shell, { findById: findEntityById });
}

export interface MergedInResearchEntityRow {
  _id: mongoose.Types.ObjectId;
  slug?: string;
}

/**
 * Lists every archived row whose tombstone chain resolves to `survivorId`, walking
 * the chain in reverse. Only archived rows are traversed, so a live row that some
 * shell points at is another survivor and is never folded into this one.
 */
export async function listResearchEntityMergedInRows(
  survivorId: string | mongoose.Types.ObjectId,
  maxHops: number = MAX_RESEARCH_ENTITY_TOMBSTONE_HOPS,
): Promise<MergedInResearchEntityRow[]> {
  if (!mongoose.Types.ObjectId.isValid(String(survivorId))) return [];
  const root = new mongoose.Types.ObjectId(String(survivorId));
  const visited = new Set<string>([String(root)]);
  const mergedIn: MergedInResearchEntityRow[] = [];
  let frontier: mongoose.Types.ObjectId[] = [root];

  for (let hop = 0; hop < maxHops && frontier.length > 0; hop += 1) {
    const rows = (await ResearchEntity.find({
      canonicalGroupId: { $in: frontier },
      archived: true,
    })
      .select('_id slug')
      .lean()) as MergedInResearchEntityRow[];
    frontier = [];
    for (const row of rows) {
      const id = String(row._id);
      if (visited.has(id)) continue;
      visited.add(id);
      mergedIn.push(row);
      frontier.push(row._id);
    }
  }

  return mergedIn;
}

export interface ResearchEntityCanonicalLookup {
  slug?: string;
  entityId?: string | mongoose.Types.ObjectId;
  isAcceptableCanonical?: ResearchEntityCanonicalAcceptance;
}

/**
 * Resolves a merged identity to the live entity it was folded into, reading the
 * archived row's own `canonicalGroupId` tombstone (#3027).
 *
 * The lookup deliberately does NOT filter `archived`, because the row being looked
 * up is the merged shell: it is the tombstone, and filtering it out is what made an
 * earlier version of this need a side ledger. A row that is already live resolves to
 * itself, so a caller can pass any identifier without knowing which it holds.
 */
export async function resolveResearchEntityCanonicalIdentity(
  lookup: ResearchEntityCanonicalLookup,
): Promise<ResearchEntityTombstoneNode | null> {
  const slug =
    typeof lookup.slug === 'string' && lookup.slug.trim() ? lookup.slug.trim() : undefined;
  const entityId =
    lookup.entityId && mongoose.Types.ObjectId.isValid(String(lookup.entityId))
      ? new mongoose.Types.ObjectId(String(lookup.entityId))
      : undefined;
  if (!slug && !entityId) return null;

  const or: Array<Record<string, unknown>> = [];
  if (entityId) or.push({ _id: entityId });
  if (slug) or.push({ slug });
  const row = (await ResearchEntity.findOne({
    $or: or,
  }).lean()) as ResearchEntityTombstoneNode | null;
  if (!row) return null;
  const isAcceptableCanonical = lookup.isAcceptableCanonical ?? acceptAnyLiveCanonical;
  if (isAcceptableCanonical(row)) return row;
  return walkResearchEntityTombstoneChain(row, {
    findById: findEntityById,
    isAcceptableCanonical,
  });
}

export interface MergeTombstoneRecordResult {
  created: boolean;
  entityId: string;
}

/**
 * Records a merged identity as an archived row carrying a `canonicalGroupId`
 * tombstone, which is how a merge is recorded since #3027.
 *
 * Reports whether it CREATED the row, because the withdrawal below deletes only a
 * row this call brought into existence. The redirect ledger it replaces scoped its
 * withdrawal by a `reason` string; a row carries no such field, and "created by me"
 * is the stronger guard anyway, since it can never remove a row another lane owns.
 */
export async function recordResearchEntityMergeTombstone(input: {
  slug: string;
  canonicalEntityId: string | mongoose.Types.ObjectId;
  name?: string;
}): Promise<MergeTombstoneRecordResult | null> {
  const slug = input.slug.trim();
  if (!slug || !mongoose.Types.ObjectId.isValid(String(input.canonicalEntityId))) return null;
  const canonicalGroupId = new mongoose.Types.ObjectId(String(input.canonicalEntityId));

  const existing = (await ResearchEntity.findOne({ slug }).select('_id').lean()) as {
    _id: mongoose.Types.ObjectId;
  } | null;
  if (existing) {
    await ResearchEntity.updateOne({ _id: existing._id }, { $set: { canonicalGroupId } });
    return { created: false, entityId: String(existing._id) };
  }

  const created = await ResearchEntity.create({
    slug,
    name: input.name?.trim() || slug,
    archived: true,
    canonicalGroupId,
  });
  return { created: true, entityId: String(created._id) };
}

export async function withdrawResearchEntityMergeTombstone(input: {
  entityId: string;
  onlyIfCreated: boolean;
}): Promise<number> {
  if (!input.onlyIfCreated) return 0;
  if (!mongoose.Types.ObjectId.isValid(input.entityId)) return 0;
  const { deletedCount } = await ResearchEntity.deleteOne({
    _id: new mongoose.Types.ObjectId(input.entityId),
    archived: true,
    canonicalGroupId: { $ne: null },
  });
  return deletedCount ?? 0;
}
