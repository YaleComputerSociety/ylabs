/**
 * Keep a merged survivor's website out of reach of a loser's lab identity once the
 * survivor's own lab-identity lane owns that slot (#3585).
 *
 * `mergedSurvivorEvidence` drops a loser's `websiteUrl` and `website` observations
 * when the survivor carries its own `entityType` from a lab-identity lane, because
 * those lanes decide name, type and website on one link. Dropping the evidence is not
 * enough on its own, for two reasons this module answers:
 *
 * - Neither field is clearable on empty, so a value already stored would stay served
 *   under a type the survivor's own lane chose because it found no lab.
 * - The loser's lane also cites its lab link in `sourceUrls`, and the citation
 *   promotion path fills an empty `websiteUrl` from citations. Without a refusal
 *   there, the clear is undone on the same pass. A refusal has to reach both write
 *   paths or it reaches neither.
 *
 * Both answers are positive rather than an absence: they act only on a value the
 * ownership rule dropped that no survivor-own observation states. It is a
 * derivation, so a second pass finds nothing to clear and no lock is needed.
 */
import { normalizeWebsiteUrlIdentityKey } from '../scripts/researchEntityPiDedupeCore';

export const SURVIVOR_OWNED_WEBSITE_FIELDS = ['website', 'websiteUrl'] as const;

export type SurvivorOwnedWebsiteField = (typeof SURVIVOR_OWNED_WEBSITE_FIELDS)[number];

const SURVIVOR_WEBSITE_STATING_FIELDS: ReadonlySet<string> = new Set([
  ...SURVIVOR_OWNED_WEBSITE_FIELDS,
  'sourceUrls',
]);

export function websiteIdentity(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return normalizeWebsiteUrlIdentityKey(trimmed) || trimmed.toLowerCase();
}

export function websiteIdentitiesStatedBy(
  observations: ReadonlyArray<{ field?: unknown; value?: unknown }>,
): Set<string> {
  const stated = new Set<string>();
  for (const observation of observations) {
    if (!SURVIVOR_WEBSITE_STATING_FIELDS.has(String(observation.field || ''))) continue;
    const values = Array.isArray(observation.value) ? observation.value : [observation.value];
    for (const value of values) {
      const identity = websiteIdentity(value);
      if (identity) stated.add(identity);
    }
  }
  return stated;
}

export function isDroppedLoserWebsite(
  value: unknown,
  droppedLoserValues: readonly unknown[],
): boolean {
  const identity = websiteIdentity(value);
  if (!identity) return false;
  return droppedLoserValues.some((dropped) => websiteIdentity(dropped) === identity);
}

export function planSurvivorOwnedWebsiteClear(input: {
  field: SurvivorOwnedWebsiteField;
  stored: Record<string, unknown> | null | undefined;
  staged: Record<string, unknown>;
  droppedLoserValues: readonly unknown[];
  lockedFields: readonly string[];
}): boolean {
  if (input.lockedFields.includes(input.field)) return false;
  const current =
    input.field in input.staged ? input.staged[input.field] : input.stored?.[input.field];
  return isDroppedLoserWebsite(current, input.droppedLoserValues);
}
