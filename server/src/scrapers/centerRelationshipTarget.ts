export const RELATIONSHIP_TARGET_WEBSITE_URL_FIELD = 'targetWebsiteUrl';

export interface RelationshipTargetIdentity {
  targetEntityKey: string;
  targetWebsiteUrl?: string;
}

interface RelationshipObservationRow {
  entityKey: string;
  field: string;
  value: unknown;
}

export function relationshipTargetIdentities(
  rows: readonly RelationshipObservationRow[],
): RelationshipTargetIdentity[] {
  const byRelationshipKey = new Map<string, Partial<RelationshipTargetIdentity>>();
  for (const row of rows) {
    if (typeof row.value !== 'string' || !row.value.trim()) continue;
    const value = row.value.trim();
    const identity = byRelationshipKey.get(row.entityKey) ?? {};
    if (row.field === 'targetEntityKey') identity.targetEntityKey = value;
    else if (row.field === RELATIONSHIP_TARGET_WEBSITE_URL_FIELD) identity.targetWebsiteUrl = value;
    else continue;
    byRelationshipKey.set(row.entityKey, identity);
  }
  const distinct = new Map<string, RelationshipTargetIdentity>();
  for (const identity of byRelationshipKey.values()) {
    if (!identity.targetEntityKey) continue;
    const resolved: RelationshipTargetIdentity = {
      targetEntityKey: identity.targetEntityKey,
      ...(identity.targetWebsiteUrl ? { targetWebsiteUrl: identity.targetWebsiteUrl } : {}),
    };
    distinct.set(`${resolved.targetEntityKey}|${resolved.targetWebsiteUrl ?? ''}`, resolved);
  }
  return Array.from(distinct.values());
}
