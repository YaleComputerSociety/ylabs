/**
 * Durable content-change gate for expensive (paid LLM) extractors.
 *
 * Records a per-(source, entity) hash of the exact bytes an extractor consumed,
 * as a latest-wins bookkeeping Observation. Before re-invoking the LLM an
 * extractor compares a freshly computed hash to the stored one and skips the
 * call when the source content is unchanged. The gate is read directly by the
 * extractor, so it survives --ignore-work-planner / --exhaustive (unlike the
 * WorkPlanner freshness skip). Only --force-llm bypasses it.
 */
import { createHash } from 'crypto';
import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import type { ObservedEntityType } from '../models/observation';
import type { ObservationInput } from './types';

export const SOURCE_CONTENT_HASH_FIELD = 'sourceContentHash';

export interface ContentHashEntityRef {
  entityType: ObservedEntityType;
  entityId?: string;
  entityKey?: string;
}

export function computeContentHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// The gate skips a paid LLM call only when the source bytes AND the extraction
// contract that would consume them are unchanged. Folding the prompt version and
// model id into the stored/compared key means a prompt improvement or model bump
// re-extracts exactly the affected entities on the next run, instead of silently
// serving output produced by an older prompt/model. Bytes-only content still
// skips when promptVersion and model are unchanged.
export function computeVersionedContentHash(
  text: string,
  promptVersion: string,
  model: string,
): string {
  return createHash('sha256')
    .update(`${computeContentHash(text)} ${promptVersion} ${model}`, 'utf8')
    .digest('hex');
}

export async function loadStoredContentHash(
  sourceName: string,
  entity: ContentHashEntityRef,
): Promise<string | undefined> {
  if (!entity.entityId && !entity.entityKey) return undefined;
  // Fail open when no DB connection is available (e.g. pure unit tests): a gate
  // lookup must never block or hang extraction, only skip re-work when it can
  // prove the content is unchanged.
  if (mongoose.connection.readyState !== 1) return undefined;
  const filter: Record<string, unknown> = {
    entityType: entity.entityType,
    sourceName,
    field: SOURCE_CONTENT_HASH_FIELD,
    superseded: false,
  };
  if (entity.entityId) filter.entityId = entity.entityId;
  else filter.entityKey = entity.entityKey;
  const row = await Observation.findOne(filter).sort({ observedAt: -1 }).select('value').lean();
  const value = (row as { value?: unknown } | null)?.value;
  return typeof value === 'string' ? value : undefined;
}

export function contentHashObservation(
  entity: ContentHashEntityRef,
  sourceUrl: string,
  hash: string,
): ObservationInput {
  return {
    entityType: entity.entityType,
    entityId: entity.entityId,
    entityKey: entity.entityKey,
    field: SOURCE_CONTENT_HASH_FIELD,
    value: hash,
    sourceUrl,
  };
}

export function contentUnchanged(
  storedHash: string | undefined,
  freshHash: string,
  forceLlm: boolean | undefined,
): boolean {
  return !forceLlm && !!storedHash && storedHash === freshHash;
}
