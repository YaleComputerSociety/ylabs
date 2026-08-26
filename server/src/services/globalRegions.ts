export const TOP_LEVEL_GLOBAL_REGIONS = [
  'Africa',
  'Asia',
  'Europe',
  'Latin America and Caribbean',
  'Middle East & Persian Gulf',
  'North America',
  'Oceania',
] as const;

const topLevelGlobalRegionSet: ReadonlySet<string> = new Set(TOP_LEVEL_GLOBAL_REGIONS);

export function distinctGlobalRegions(regions: readonly string[] | undefined): string[] {
  if (!Array.isArray(regions)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const region of regions) {
    const trimmed = typeof region === 'string' ? region.trim() : '';
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

export function isFullRegionEnumeration(regions: readonly string[] | undefined): boolean {
  const distinct = distinctGlobalRegions(regions);
  if (distinct.length !== topLevelGlobalRegionSet.size) return false;
  return distinct.every((region) => topLevelGlobalRegionSet.has(region));
}

export function collapseDefaultFillGlobalRegions(regions: readonly string[] | undefined): string[] {
  const distinct = distinctGlobalRegions(regions);
  return isFullRegionEnumeration(distinct) ? [] : distinct;
}
