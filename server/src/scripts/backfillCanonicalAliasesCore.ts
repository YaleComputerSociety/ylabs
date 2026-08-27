import type { CanonicalType } from '../models/canonicalAlias';

export interface PlannedCanonicalAlias {
  type: CanonicalType;
  aliasNs: string;
  aliasValue: string;
  canonicalType: CanonicalType;
  canonicalId: string;
  reason: string;
}

export interface RedirectRow {
  mergedSlug?: string | null;
  mergedEntityId?: string | null;
  canonicalEntityId?: string | null;
}

export interface UserTombstoneRow {
  _id: string;
  dedupedIntoUserId?: string | null;
  netid?: string | null;
  email?: string | null;
  orcid?: string | null;
}

export interface ResearcherTombstoneRow {
  _id: string;
  dedupedIntoResearcherId?: string | null;
  orcid?: string | null;
}

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export function planCanonicalAliasesFromRedirects(rows: RedirectRow[]): PlannedCanonicalAlias[] {
  const planned: PlannedCanonicalAlias[] = [];
  for (const row of rows) {
    const canonicalId = text(row.canonicalEntityId);
    if (!canonicalId) continue;
    const base = {
      type: 'researchEntity' as const,
      canonicalType: 'researchEntity' as const,
      canonicalId,
      reason: 'backfill_research_entity_redirect',
    };
    const slug = text(row.mergedSlug);
    if (slug) planned.push({ ...base, aliasNs: 'slug', aliasValue: slug });
    const entityId = text(row.mergedEntityId);
    if (entityId && entityId !== canonicalId) {
      planned.push({ ...base, aliasNs: 'id', aliasValue: entityId });
    }
  }
  return planned;
}

export function planCanonicalAliasesFromUserTombstones(
  rows: UserTombstoneRow[],
): PlannedCanonicalAlias[] {
  const planned: PlannedCanonicalAlias[] = [];
  for (const row of rows) {
    const canonicalId = text(row.dedupedIntoUserId);
    const mergedId = text(row._id);
    if (!canonicalId || !mergedId || canonicalId === mergedId) continue;
    const base = {
      type: 'user' as const,
      canonicalType: 'user' as const,
      canonicalId,
      reason: 'backfill_user_identity_dedupe',
    };
    planned.push({ ...base, aliasNs: 'id', aliasValue: mergedId });
    const netid = text(row.netid);
    if (netid) planned.push({ ...base, aliasNs: 'netid', aliasValue: netid });
    const email = text(row.email).toLowerCase();
    if (email) planned.push({ ...base, aliasNs: 'email', aliasValue: email });
    const orcid = text(row.orcid);
    if (orcid) planned.push({ ...base, aliasNs: 'orcid', aliasValue: orcid });
  }
  return planned;
}

export function planCanonicalAliasesFromResearcherTombstones(
  rows: ResearcherTombstoneRow[],
): PlannedCanonicalAlias[] {
  const planned: PlannedCanonicalAlias[] = [];
  for (const row of rows) {
    const canonicalId = text(row.dedupedIntoResearcherId);
    const mergedId = text(row._id);
    if (!canonicalId || !mergedId || canonicalId === mergedId) continue;
    const base = {
      type: 'researcher' as const,
      canonicalType: 'researcher' as const,
      canonicalId,
      reason: 'backfill_researcher_dedupe',
    };
    planned.push({ ...base, aliasNs: 'id', aliasValue: mergedId });
    const orcid = text(row.orcid);
    if (orcid) planned.push({ ...base, aliasNs: 'orcid', aliasValue: orcid });
  }
  return planned;
}

export function dedupePlannedAliases(
  planned: PlannedCanonicalAlias[],
): PlannedCanonicalAlias[] {
  const seen = new Set<string>();
  const out: PlannedCanonicalAlias[] = [];
  for (const alias of planned) {
    const key = `${alias.type} ${alias.aliasNs} ${alias.aliasValue}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
  }
  return out;
}
