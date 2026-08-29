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

export type ResearchEntityCanonicalAcceptance = (candidate: Record<string, any>) => boolean;

const acceptAnyLiveCanonical: ResearchEntityCanonicalAcceptance = (candidate) =>
  candidate.archived !== true;

export interface ResearchEntityCanonicalResolutionInput extends ResearchEntityRedirectLookup {
  /**
   * Extra chain entry points tried before the redirect table, in order. The
   * public detail route seeds the merged shell's own `canonicalGroupId`
   * tombstone here so a surviving shell resolves without a redirect row.
   */
  seedCanonicalIds?: Array<string | mongoose.Types.ObjectId | null | undefined>;
  isAcceptableCanonical?: ResearchEntityCanonicalAcceptance;
}

/**
 * Resolves a merged entity's identifiers to the canonical entity it was folded
 * into, following `canonicalGroupId` tombstones and `research_entity_redirects`
 * rows so a canonical that was itself later merged still resolves onward.
 *
 * This is the single canonical-redirect resolver. Resolving from
 * `research_entities` alone is NOT delete-safe: `research-entity:cleanup-archived`
 * is designed to delete merged shell rows, which erases the `canonicalGroupId`
 * tombstone. Any new caller must come through here so it also reads the
 * redirect table, which outlives the shell.
 */
export async function resolveResearchEntityCanonical(
  input: ResearchEntityCanonicalResolutionInput,
): Promise<Record<string, any> | null> {
  const slug = typeof input.slug === 'string' && input.slug.trim() ? input.slug.trim() : undefined;
  const entityId = toObjectId(input.entityId);
  const isAcceptableCanonical = input.isAcceptableCanonical ?? acceptAnyLiveCanonical;

  for (const seed of input.seedCanonicalIds ?? []) {
    const seedId = toObjectId(seed);
    if (!seedId) continue;
    const resolved = await walkCanonicalChain(seedId, entityId, isAcceptableCanonical);
    if (resolved) return resolved;
  }

  if (!slug && !entityId) return null;
  const or: Array<Record<string, unknown>> = [];
  if (entityId) or.push({ mergedEntityId: entityId });
  if (slug) or.push({ mergedSlug: slug });
  const redirectCanonicalId = await lookupRedirectCanonicalId({ $or: or });
  if (!redirectCanonicalId) return null;
  return walkCanonicalChain(redirectCanonicalId, entityId, isAcceptableCanonical);
}

/**
 * Delete-safe shell -> canonical resolution for scraper materialization: any
 * live (non-archived) canonical is acceptable regardless of student visibility.
 */
export async function resolveResearchEntityMergeRedirectCanonical(
  lookup: ResearchEntityRedirectLookup,
): Promise<any | null> {
  const slug =
    typeof lookup.slug === 'string' && lookup.slug.trim() ? lookup.slug.trim() : undefined;
  const entityId = toObjectId(lookup.entityId);
  if (!slug && !entityId) return null;
  return resolveResearchEntityCanonical({ slug, entityId });
}

async function walkCanonicalChain(
  seedCanonicalId: mongoose.Types.ObjectId,
  originEntityId: mongoose.Types.ObjectId | undefined,
  isAcceptableCanonical: ResearchEntityCanonicalAcceptance,
): Promise<Record<string, any> | null> {
  const visited = new Set<string>();
  if (originEntityId) visited.add(String(originEntityId));
  let nextId: mongoose.Types.ObjectId | null | undefined = seedCanonicalId;

  for (let hop = 0; hop < MAX_RESEARCH_ENTITY_REDIRECT_HOPS && nextId; hop += 1) {
    const nextKey = String(nextId);
    if (visited.has(nextKey)) return null;
    visited.add(nextKey);

    const candidate = (await ResearchEntity.findOne({
      _id: nextId,
    }).lean()) as ResearchEntityChainNode | null;
    if (candidate && isAcceptableCanonical(candidate)) return candidate;
    if (candidate?.canonicalGroupId) {
      nextId = candidate.canonicalGroupId;
      continue;
    }

    nextId = await lookupRedirectCanonicalId({ mergedEntityId: nextId });
    if (!nextId) return null;
  }

  return null;
}

interface ResearchEntityChainNode extends Record<string, any> {
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
