import mongoose from 'mongoose';
import { ResearchEntity } from '../models/researchEntity';

export const MAX_RESEARCH_ENTITY_TOMBSTONE_HOPS = 10;

export interface ResearchEntityTombstoneNode extends Record<string, any> {
  _id: mongoose.Types.ObjectId;
  archived?: boolean;
  canonicalGroupId?: mongoose.Types.ObjectId | null;
}

export interface ResearchEntityTombstoneChainDeps {
  findById: (id: string) => Promise<ResearchEntityTombstoneNode | null>;
  maxHops?: number;
}

export async function walkResearchEntityTombstoneChain(
  start: ResearchEntityTombstoneNode,
  deps: ResearchEntityTombstoneChainDeps,
): Promise<ResearchEntityTombstoneNode | null> {
  const maxHops = deps.maxHops ?? MAX_RESEARCH_ENTITY_TOMBSTONE_HOPS;
  const visited = new Set<string>([String(start._id)]);
  let nextId = start.canonicalGroupId ? String(start.canonicalGroupId) : null;

  for (let hop = 0; hop < maxHops && nextId; hop += 1) {
    if (visited.has(nextId)) return null;
    visited.add(nextId);
    const candidate = await deps.findById(nextId);
    if (!candidate) return null;
    if (candidate.archived !== true) return candidate;
    nextId = candidate.canonicalGroupId ? String(candidate.canonicalGroupId) : null;
  }

  return null;
}

export async function resolveResearchEntityCanonicalByTombstone(
  shell: ResearchEntityTombstoneNode,
): Promise<ResearchEntityTombstoneNode | null> {
  return walkResearchEntityTombstoneChain(shell, {
    findById: async (id) => {
      if (!mongoose.Types.ObjectId.isValid(id)) return null;
      return (await ResearchEntity.findById(
        new mongoose.Types.ObjectId(id),
      ).lean()) as ResearchEntityTombstoneNode | null;
    },
  });
}
