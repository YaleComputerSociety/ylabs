export const RELATIONSHIP_TARGET_WEBSITE_URL_FIELD = 'targetWebsiteUrl';
export const RELATIONSHIP_TARGET_LEAD_NAME_FIELD = 'targetLeadName';
export const LISTED_LAB_TARGET_KEY_PREFIX = 'listed-lab-';

export function isListedLabTargetKey(targetEntityKey: string): boolean {
  return targetEntityKey.startsWith(LISTED_LAB_TARGET_KEY_PREFIX);
}

export interface RelationshipTargetIdentity {
  targetEntityKey: string;
  targetWebsiteUrl?: string;
  targetLeadName?: string;
}

interface RelationshipObservationRow {
  entityKey: string;
  field: string;
  value: unknown;
}

export function relationshipTargetIdentities(
  rows: readonly RelationshipObservationRow[],
): RelationshipTargetIdentity[] {
  const byRelationshipKey = new Map<
    string,
    { targetEntityKeys: Set<string>; urls: Set<string>; leadNames: Set<string> }
  >();
  for (const row of rows) {
    if (typeof row.value !== 'string' || !row.value.trim()) continue;
    const value = row.value.trim();
    const observed = byRelationshipKey.get(row.entityKey) ?? {
      targetEntityKeys: new Set<string>(),
      urls: new Set<string>(),
      leadNames: new Set<string>(),
    };
    if (row.field === 'targetEntityKey') observed.targetEntityKeys.add(value);
    else if (row.field === RELATIONSHIP_TARGET_WEBSITE_URL_FIELD) observed.urls.add(value);
    else if (row.field === RELATIONSHIP_TARGET_LEAD_NAME_FIELD) observed.leadNames.add(value);
    else continue;
    byRelationshipKey.set(row.entityKey, observed);
  }
  const distinct = new Map<string, RelationshipTargetIdentity>();
  for (const { targetEntityKeys, urls, leadNames } of byRelationshipKey.values()) {
    const websiteUrls = urls.size > 0 ? Array.from(urls) : [undefined];
    const targetLeadName = leadNames.size === 1 ? Array.from(leadNames)[0] : undefined;
    for (const targetEntityKey of targetEntityKeys) {
      for (const targetWebsiteUrl of websiteUrls) {
        distinct.set(`${targetEntityKey}|${targetWebsiteUrl ?? ''}`, {
          targetEntityKey,
          ...(targetWebsiteUrl ? { targetWebsiteUrl } : {}),
          ...(targetLeadName ? { targetLeadName } : {}),
        });
      }
    }
  }
  return Array.from(distinct.values());
}
