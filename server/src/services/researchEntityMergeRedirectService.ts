import mongoose from 'mongoose';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchEntityRedirect } from '../models/researchEntityRedirect';

export const DEFAULT_RESEARCH_ENTITY_MERGE_REDIRECT_REASON = 'research_entity_dedupe_merge';
const MAX_RESEARCH_ENTITY_REDIRECT_HOPS = 10;

export interface MergedShellIdentity {
  entityId: string | mongoose.Types.ObjectId;
  slug?: string;
}

export interface RecordResearchEntityMergeRedirectsInput {
  canonicalEntityId: string | mongoose.Types.ObjectId;
  mergedShells: MergedShellIdentity[];
  reason?: string;
  mergedAt?: Date;
}

function toObjectId(value: unknown): mongoose.Types.ObjectId | undefined {
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!mongoose.Types.ObjectId.isValid(trimmed)) return undefined;
  return new mongoose.Types.ObjectId(trimmed);
}

/**
 * Records durable shell -> canonical redirects for every shell collapsed by a
 * merge. Keyed on the shell's original entity id so a re-run of the same merge
 * upserts the same record (idempotent). The mapping outlives deletion of the
 * shell row, which is what lets a later re-scrape resolve to the canonical
 * without re-minting the shell (issue #1957, PR 3).
 */
export async function recordResearchEntityMergeRedirects(
  input: RecordResearchEntityMergeRedirectsInput,
): Promise<number> {
  const canonicalId = toObjectId(input.canonicalEntityId);
  if (!canonicalId) return 0;
  const mergedAt = input.mergedAt ?? new Date();
  const reason = input.reason ?? DEFAULT_RESEARCH_ENTITY_MERGE_REDIRECT_REASON;

  let recorded = 0;
  for (const shell of input.mergedShells) {
    const mergedEntityId = toObjectId(shell.entityId);
    if (!mergedEntityId) continue;
    if (mergedEntityId.equals(canonicalId)) continue;
    const mergedSlug =
      typeof shell.slug === 'string' && shell.slug.trim() ? shell.slug.trim() : undefined;
    const upsertKey = mergedSlug ? { mergedSlug } : { mergedEntityId };
    await ResearchEntityRedirect.updateOne(
      upsertKey,
      {
        $set: {
          mergedEntityId,
          canonicalEntityId: canonicalId,
          canonicalGroupId: canonicalId,
          reason,
          ...(mergedSlug ? { mergedSlug } : {}),
        },
        $setOnInsert: { mergedAt },
      },
      { upsert: true },
    );
    recorded += 1;
  }
  return recorded;
}

export interface ResearchEntityRedirectLookup {
  slug?: string;
  entityId?: string | mongoose.Types.ObjectId;
}

/**
 * Resolves a merged shell's source identifiers to the live canonical entity it
 * was folded into, following redirect and `canonicalGroupId` chains so a canonical
 * that was itself later merged still resolves onward. Returns the canonical
 * ResearchEntity document (lean) or null when no live canonical is reachable.
 * Delete-safe: resolution never depends on the shell row still existing.
 */
export async function resolveResearchEntityMergeRedirectCanonical(
  lookup: ResearchEntityRedirectLookup,
): Promise<any | null> {
  const slug = typeof lookup.slug === 'string' && lookup.slug.trim() ? lookup.slug.trim() : undefined;
  const entityId = toObjectId(lookup.entityId);
  if (!slug && !entityId) return null;

  const or: Array<Record<string, unknown>> = [];
  if (entityId) or.push({ mergedEntityId: entityId });
  if (slug) or.push({ mergedSlug: slug });
  const redirectCanonicalId = await lookupRedirectCanonicalId({ $or: or });
  if (!redirectCanonicalId) return null;

  const visited = new Set<string>();
  if (entityId) visited.add(String(entityId));
  let nextId: mongoose.Types.ObjectId | null | undefined = redirectCanonicalId;

  for (let hop = 0; hop < MAX_RESEARCH_ENTITY_REDIRECT_HOPS && nextId; hop += 1) {
    const nextKey = String(nextId);
    if (visited.has(nextKey)) return null;
    visited.add(nextKey);

    const candidate = (await ResearchEntity.findById(nextId).lean()) as ResearchEntityChainNode | null;
    if (candidate && candidate.archived !== true) return candidate;
    if (candidate?.canonicalGroupId) {
      nextId = candidate.canonicalGroupId;
      continue;
    }

    nextId = await lookupRedirectCanonicalId({ mergedEntityId: nextId });
    if (!nextId) return null;
  }

  return null;
}

interface ResearchEntityChainNode {
  _id: mongoose.Types.ObjectId;
  archived?: boolean;
  canonicalGroupId?: mongoose.Types.ObjectId | null;
}

async function lookupRedirectCanonicalId(
  filter: Record<string, unknown>,
): Promise<mongoose.Types.ObjectId | null> {
  const redirect = (await ResearchEntityRedirect.findOne(filter)
    .select('canonicalEntityId')
    .lean()) as { canonicalEntityId?: mongoose.Types.ObjectId } | null;
  return redirect?.canonicalEntityId ?? null;
}
