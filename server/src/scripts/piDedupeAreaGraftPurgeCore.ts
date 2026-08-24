/**
 * Pure planning helpers for the #604 PI-dedupe unbacked researchArea graft purge.
 *
 * #757 trust-filtered shell areas at PI-dedupe merge time going forward, but it
 * does not retroactively repair canonicals a prior merge already contaminated.
 * Those grafted `researchAreas` are unbacked direct-writes with no owning
 * `fieldProvenance` entry, so a field-scoped rematerialize cannot self-heal them.
 * As with the #1256 same-name-collision purge, a broad "off-topic area" filter
 * would over-purge genuine interdisciplinary scholars, so removal is scoped to
 * an individually verified set of exact graft strings per entity.
 */

export function normalizeGraftToken(value: string): string {
  return String(value)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export interface AreaGraftRemovalInput {
  current: string[];
  removeAreas: string[];
}

export interface AreaGraftRemovalResult {
  cleaned: string[];
  removed: string[];
  changed: boolean;
}

export function planAreaGraftRemoval(input: AreaGraftRemovalInput): AreaGraftRemovalResult {
  const removeSet = new Set(input.removeAreas.map(normalizeGraftToken));
  const removed: string[] = [];
  const cleaned = input.current.filter((value) => {
    const isGraft = removeSet.has(normalizeGraftToken(value));
    if (isGraft) removed.push(value);
    return !isGraft;
  });
  return { cleaned, removed, changed: removed.length > 0 };
}
