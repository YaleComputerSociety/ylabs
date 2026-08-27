import mongoose from 'mongoose';
import { CanonicalAlias, type CanonicalType } from '../models/canonicalAlias';
import { ResearchEntity } from '../models/researchEntity';
import { User } from '../models/user';
import { Researcher } from '../models/researcher';
import { Fellowship } from '../models/fellowship';

export const MAX_CANONICAL_ALIAS_HOPS = 10;

export function normalizeAliasValue(aliasNs: string, value: string): string {
  const trimmed = value.trim();
  if (aliasNs === 'email') return trimmed.toLowerCase();
  if (aliasNs === 'orcid') return trimmed.toUpperCase();
  return trimmed;
}

function toObjectId(value: unknown): mongoose.Types.ObjectId | undefined {
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!mongoose.Types.ObjectId.isValid(trimmed)) return undefined;
  return new mongoose.Types.ObjectId(trimmed);
}

export interface RecordCanonicalAliasInput {
  type: CanonicalType;
  aliasNs: string;
  aliasValue: string;
  canonicalType: CanonicalType;
  canonicalId: string | mongoose.Types.ObjectId;
  reason?: string;
  mergedAt?: Date;
}

export async function recordCanonicalAlias(input: RecordCanonicalAliasInput): Promise<boolean> {
  const canonicalId = toObjectId(input.canonicalId);
  const aliasNs = typeof input.aliasNs === 'string' ? input.aliasNs.trim() : '';
  const aliasValue =
    typeof input.aliasValue === 'string' ? normalizeAliasValue(aliasNs, input.aliasValue) : '';
  if (!canonicalId || !aliasValue || !aliasNs) return false;
  await CanonicalAlias.updateOne(
    { type: input.type, aliasNs, aliasValue },
    {
      $set: {
        canonicalType: input.canonicalType,
        canonicalId,
        active: true,
        ...(input.reason ? { reason: input.reason } : {}),
      },
      $setOnInsert: { mergedAt: input.mergedAt ?? new Date() },
    },
    { upsert: true },
  );
  return true;
}

export interface CanonicalAliasChainDeps {
  isLiveCanonical: (id: string) => Promise<boolean>;
  nextCanonical: (id: string) => Promise<string | null>;
  maxHops?: number;
}

/**
 * Pure chain walk shared by resolution. Returns the first live canonical id
 * reachable from `start`, following `nextCanonical` when the current id is not a
 * live canonical (archived / merged onward / deleted). Returns null on a cycle,
 * on running out of hops, or when the chain dead-ends without a live canonical -
 * so a dangling id is never returned.
 */
export async function walkCanonicalAliasChain(
  start: string,
  deps: CanonicalAliasChainDeps,
): Promise<string | null> {
  const visited = new Set<string>();
  const maxHops = deps.maxHops ?? MAX_CANONICAL_ALIAS_HOPS;
  let current: string | null = start;
  for (let hop = 0; hop < maxHops && current; hop += 1) {
    if (visited.has(current)) return null;
    visited.add(current);
    if (await deps.isLiveCanonical(current)) return current;
    current = await deps.nextCanonical(current);
  }
  return null;
}

function modelForType(type: CanonicalType): mongoose.Model<any> | null {
  switch (type) {
    case 'researchEntity':
      return ResearchEntity;
    case 'user':
      return User;
    case 'researcher':
      return Researcher;
    case 'fellowship':
      return Fellowship;
    default:
      return null;
  }
}

/**
 * Resolves an alias identifier to its live canonical record id, following
 * merge/re-key chains. Delete-safe and cycle-guarded. Returns null when no live
 * canonical is reachable.
 */
export async function resolveCanonicalAlias(
  type: CanonicalType,
  aliasNs: string,
  aliasValue: string,
): Promise<mongoose.Types.ObjectId | null> {
  const value = typeof aliasValue === 'string' ? normalizeAliasValue(aliasNs, aliasValue) : '';
  if (!value) return null;
  const alias = (await CanonicalAlias.findOne({ type, aliasNs, aliasValue: value, active: true })
    .select('canonicalId canonicalType')
    .lean()) as { canonicalId?: mongoose.Types.ObjectId; canonicalType?: CanonicalType } | null;
  if (!alias?.canonicalId || !alias.canonicalType) return null;

  const canonicalType = alias.canonicalType;
  const Model = modelForType(canonicalType);
  if (!Model) return null;

  const resolved = await walkCanonicalAliasChain(String(alias.canonicalId), {
    isLiveCanonical: async (id) => {
      const oid = toObjectId(id);
      if (!oid) return false;
      const doc = (await Model.findById(oid).select('archived').lean()) as {
        archived?: boolean;
      } | null;
      return !!doc && doc.archived !== true;
    },
    nextCanonical: async (id) => {
      const oid = toObjectId(id);
      if (!oid) return null;
      if (canonicalType === 'researchEntity') {
        const doc = (await ResearchEntity.findById(oid).select('canonicalGroupId').lean()) as {
          canonicalGroupId?: mongoose.Types.ObjectId | null;
        } | null;
        if (doc?.canonicalGroupId) return String(doc.canonicalGroupId);
      }
      const onward = (await CanonicalAlias.findOne({
        canonicalType,
        aliasNs: 'id',
        aliasValue: id,
        active: true,
      })
        .select('canonicalId')
        .lean()) as { canonicalId?: mongoose.Types.ObjectId } | null;
      if (onward?.canonicalId && String(onward.canonicalId) !== id)
        return String(onward.canonicalId);
      return null;
    },
  });

  return resolved ? (toObjectId(resolved) ?? null) : null;
}
