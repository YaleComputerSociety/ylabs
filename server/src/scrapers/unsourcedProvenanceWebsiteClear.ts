/**
 * A stored `websiteUrl` whose provenance names a lane but carries neither a `sourceId`
 * nor an `observationId` was written directly rather than resolved from evidence
 * (#3363, #3586). The record itself is the positive evidence, so this clears only when
 * no observation the pass reads states the value; an absent observation alone never
 * clears, because retention can prune the evidence behind a real value.
 */
import { websiteIdentitiesStatedBy, websiteIdentity } from './survivorOwnedWebsiteClear';

export interface WebsiteUrlProvenanceRecord {
  sourceName?: unknown;
  sourceId?: unknown;
  observationId?: unknown;
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim().length > 0;
}

export function isUnsourcedProvenanceRecord(provenance: unknown): boolean {
  if (!provenance || typeof provenance !== 'object') return false;
  const record = provenance as WebsiteUrlProvenanceRecord;
  return (
    isPresent(record.sourceName) && !isPresent(record.sourceId) && !isPresent(record.observationId)
  );
}

export function storedWebsiteUrlProvenance(stored: unknown): unknown {
  if (!stored || typeof stored !== 'object') return undefined;
  const provenance = (stored as { fieldProvenance?: unknown }).fieldProvenance;
  if (provenance instanceof Map) return provenance.get('websiteUrl');
  if (!provenance || typeof provenance !== 'object') return undefined;
  return (provenance as Record<string, unknown>).websiteUrl;
}

export function planUnsourcedProvenanceWebsiteUrlClear(input: {
  stored: Record<string, unknown> | null | undefined;
  staged: Record<string, unknown>;
  observations: ReadonlyArray<{ field?: unknown; value?: unknown }>;
  lockedFields: readonly string[];
}): boolean {
  if (input.lockedFields.includes('websiteUrl')) return false;
  if ('websiteUrl' in input.staged) return false;
  const identity = websiteIdentity(input.stored?.websiteUrl);
  if (!identity) return false;
  if (!isUnsourcedProvenanceRecord(storedWebsiteUrlProvenance(input.stored))) return false;
  return !websiteIdentitiesStatedBy(input.observations).has(identity);
}
