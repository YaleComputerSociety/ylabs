import mongoose from 'mongoose';
import { ResearchEntity } from '../models/researchEntity';
import { MAX_RESEARCH_ENTITY_TOMBSTONE_HOPS } from './researchEntityCanonicalTombstone';

export interface MergedFromEntry {
  slug: string;
  entityId: string;
  mergedAt?: Date;
  archivedReason?: string;
}

export interface MergedFromNode {
  id: string;
  slug: string;
  archived: boolean;
  canonicalGroupId?: string;
  archivedAt?: Date;
  archivedReason?: string;
  mergedFrom?: MergedFromEntry[];
}

export interface MergedFromWrite {
  survivorId: string;
  mergedFrom: MergedFromEntry[];
}

export interface MergedFromPlan {
  tombstones: number;
  unresolvedTombstones: number;
  survivorsWithMergedFrom: number;
  mergedEntries: number;
  writes: MergedFromWrite[];
  clears: string[];
}

function liveSurvivorOf(
  node: MergedFromNode,
  nodesById: ReadonlyMap<string, MergedFromNode>,
): MergedFromNode | undefined {
  const visited = new Set([node.id]);
  let nextId = node.canonicalGroupId;
  for (let hops = 0; nextId && hops < MAX_RESEARCH_ENTITY_TOMBSTONE_HOPS; hops += 1) {
    if (visited.has(nextId)) return undefined;
    visited.add(nextId);
    const candidate = nodesById.get(nextId);
    if (!candidate) return undefined;
    if (!candidate.archived) return candidate;
    nextId = candidate.canonicalGroupId;
  }
  return undefined;
}

const entryKey = (entry: MergedFromEntry): string =>
  [
    entry.slug,
    entry.entityId,
    entry.mergedAt ? entry.mergedAt.toISOString() : '',
    entry.archivedReason ?? '',
  ].join('|');

const sameEntries = (left: readonly MergedFromEntry[], right: readonly MergedFromEntry[]) =>
  left.length === right.length &&
  left.every((entry, index) => entryKey(entry) === entryKey(right[index]));

// Every archived row with a tombstone is credited to the live row its chain ends on, so a
// chain of merges flattens onto the final survivor. A chain that cycles, points at a missing
// row, or ends on an archived row names no survivor and contributes nothing.
export function planMergedFromDerivation(nodes: readonly MergedFromNode[]): MergedFromPlan {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const derived = new Map<string, MergedFromEntry[]>();
  let tombstones = 0;
  let unresolvedTombstones = 0;
  for (const node of nodes) {
    if (!node.archived || !node.canonicalGroupId) continue;
    tombstones += 1;
    const survivor = liveSurvivorOf(node, nodesById);
    if (!survivor || !node.slug) {
      unresolvedTombstones += 1;
      continue;
    }
    const entries = derived.get(survivor.id) ?? [];
    entries.push({
      slug: node.slug,
      entityId: node.id,
      ...(node.archivedAt ? { mergedAt: node.archivedAt } : {}),
      ...(node.archivedReason ? { archivedReason: node.archivedReason } : {}),
    });
    derived.set(survivor.id, entries);
  }

  const writes: MergedFromWrite[] = [];
  const clears: string[] = [];
  let mergedEntries = 0;
  for (const node of nodes) {
    if (node.archived) {
      if (node.mergedFrom !== undefined) clears.push(node.id);
      continue;
    }
    const stored = node.mergedFrom ?? [];
    const next = (derived.get(node.id) ?? []).sort(
      (left, right) =>
        left.slug.localeCompare(right.slug) || left.entityId.localeCompare(right.entityId),
    );
    mergedEntries += next.length;
    if (next.length === 0) {
      if (node.mergedFrom !== undefined) clears.push(node.id);
      continue;
    }
    if (!sameEntries(stored, next)) writes.push({ survivorId: node.id, mergedFrom: next });
  }

  return {
    tombstones,
    unresolvedTombstones,
    survivorsWithMergedFrom: [...derived.keys()].filter((id) => !nodesById.get(id)?.archived)
      .length,
    mergedEntries,
    writes,
    clears,
  };
}

const textOf = (value: unknown): string =>
  value === undefined || value === null ? '' : String(value);

const dateOf = (value: unknown): Date | undefined =>
  value instanceof Date && !Number.isNaN(value.getTime()) ? value : undefined;

export async function loadMergedFromNodes(): Promise<MergedFromNode[]> {
  const rows = (await ResearchEntity.find({})
    .select('_id slug archived canonicalGroupId archivedAt archivedReason mergedFrom')
    .lean()) as Array<Record<string, any>>;
  return rows.map((row) => ({
    id: textOf(row._id),
    slug: textOf(row.slug),
    archived: row.archived === true,
    ...(row.canonicalGroupId ? { canonicalGroupId: textOf(row.canonicalGroupId) } : {}),
    ...(dateOf(row.archivedAt) ? { archivedAt: dateOf(row.archivedAt) } : {}),
    ...(typeof row.archivedReason === 'string' && row.archivedReason.trim()
      ? { archivedReason: row.archivedReason.trim() }
      : {}),
    ...(Array.isArray(row.mergedFrom)
      ? {
          mergedFrom: row.mergedFrom.map((entry: Record<string, unknown>) => ({
            slug: textOf(entry.slug),
            entityId: textOf(entry.entityId),
            ...(dateOf(entry.mergedAt) ? { mergedAt: dateOf(entry.mergedAt) } : {}),
            ...(typeof entry.archivedReason === 'string'
              ? { archivedReason: entry.archivedReason }
              : {}),
          })),
        }
      : {}),
  }));
}

// `mergedFrom` is not part of a served or indexed document, so the write skips timestamps
// rather than bump `updatedAt` on every survivor and wake the search catch-up for nothing.
export async function applyMergedFromPlan(
  plan: Pick<MergedFromPlan, 'writes' | 'clears'>,
): Promise<{ written: number; cleared: number }> {
  let written = 0;
  let cleared = 0;
  for (const write of plan.writes) {
    const result = await ResearchEntity.updateOne(
      { _id: new mongoose.Types.ObjectId(write.survivorId), archived: { $ne: true } },
      {
        $set: {
          mergedFrom: write.mergedFrom.map((entry) => ({
            ...entry,
            entityId: new mongoose.Types.ObjectId(entry.entityId),
          })),
        },
      },
      { timestamps: false },
    );
    written += result.modifiedCount ?? 0;
  }
  for (const survivorId of plan.clears) {
    const result = await ResearchEntity.updateOne(
      { _id: new mongoose.Types.ObjectId(survivorId) },
      { $unset: { mergedFrom: '' } },
      { timestamps: false },
    );
    cleared += result.modifiedCount ?? 0;
  }
  return { written, cleared };
}
