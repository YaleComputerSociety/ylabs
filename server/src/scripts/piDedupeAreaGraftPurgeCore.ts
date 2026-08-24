/**
 * Pure planning helpers for the #604 PI-dedupe unbacked graft purge.
 *
 * #757 trust-filtered shell areas and best-selected descriptions at PI-dedupe
 * merge time going forward, but it does not retroactively repair canonicals a
 * prior merge already contaminated. Those grafted `researchAreas` and the
 * hallucinated `fullDescription`/`shortDescription` are unbacked direct-writes
 * with no owning `fieldProvenance` entry, so a field-scoped rematerialize cannot
 * self-heal them. As with the #1256 same-name-collision purge, a broad
 * "off-topic" filter would over-purge genuine interdisciplinary scholars, so
 * removal is scoped to an individually verified set of exact graft strings per
 * entity, and each description clear only fires when the stored text still
 * exactly matches the verified hallucination (a since-self-corrected record is a
 * no-op).
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

export interface DescriptionGraftRemovalInput {
  currentFull?: string;
  currentShort?: string;
  removeFull?: string;
  removeShort?: string;
}

export interface DescriptionGraftRemovalResult {
  clearFull: boolean;
  clearShort: boolean;
  changed: boolean;
}

export function planDescriptionGraftRemoval(
  input: DescriptionGraftRemovalInput,
): DescriptionGraftRemovalResult {
  const matches = (current: string | undefined, target: string | undefined): boolean =>
    Boolean(target && target.trim()) &&
    normalizeGraftToken(current || '') === normalizeGraftToken(target || '');
  const clearFull = matches(input.currentFull, input.removeFull);
  const clearShort = matches(input.currentShort, input.removeShort);
  return { clearFull, clearShort, changed: clearFull || clearShort };
}
