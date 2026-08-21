import type { ResearchAreaCanonicalizer } from '../server/src/scrapers/researchAreaCanonicalization';
import {
  MAX_TAXONOMY_ALIASES,
  normalizeTaxonomyLabel,
  taxonomyTermSchemaVersion,
  type TaxonomyTermKind,
  type TaxonomyTermReviewStatus,
} from '../server/src/models/taxonomyTerm';

export interface TaxonomyTermSeedRow {
  schemaVersion: number;
  kind: TaxonomyTermKind;
  label: string;
  normalizedLabel: string;
  aliases: string[];
  reviewStatus: TaxonomyTermReviewStatus;
  status: 'ACTIVE';
  archived: false;
}

function cleanAliases(aliases: readonly string[] | undefined, normalizedLabel: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const alias of aliases ?? []) {
    const trimmed = String(alias ?? '').trim();
    if (!trimmed) continue;
    const key = normalizeTaxonomyLabel(trimmed);
    if (!key || key === normalizedLabel || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= MAX_TAXONOMY_ALIASES) break;
  }
  return out;
}

/**
 * Deterministic APPROVED `TaxonomyTerm` seed rows built from the curated
 * research-area ground truth plus curated aliases. Approved terms are the only
 * ones ingest canonicalization matches, so this ground truth is the ratified
 * canonical vocabulary. Deduped by `(kind, normalizedLabel)` with the first
 * occurrence winning.
 */
export function buildApprovedTaxonomyTermSeedRows(
  groundTruth: ReadonlyArray<{ name: string }>,
  aliasMap: Record<string, readonly string[]> = {},
  kind: TaxonomyTermKind = 'TOPIC',
): TaxonomyTermSeedRow[] {
  const rows: TaxonomyTermSeedRow[] = [];
  const seen = new Set<string>();
  for (const entry of groundTruth) {
    const label = String(entry.name ?? '').trim();
    if (!label) continue;
    const normalizedLabel = normalizeTaxonomyLabel(label);
    if (!normalizedLabel || seen.has(normalizedLabel)) continue;
    seen.add(normalizedLabel);
    rows.push({
      schemaVersion: taxonomyTermSchemaVersion.currentVersion,
      kind,
      label,
      normalizedLabel,
      aliases: cleanAliases(aliasMap[label], normalizedLabel),
      reviewStatus: 'APPROVED',
      status: 'ACTIVE',
      archived: false,
    });
  }
  return rows;
}

/**
 * Deterministic UNREVIEWED candidate rows generated from the residual scraped
 * area strings that did not resolve against the approved seed. They are parked
 * for human ratification and never participate in canonicalization until an
 * approver promotes them, so guessed groupings can never collapse distinct
 * topics. Any label already present in `approvedNormalizedLabels` is skipped.
 */
export function buildCandidateTaxonomyTermSeedRows(
  candidateLabels: readonly string[],
  approvedNormalizedLabels: ReadonlySet<string>,
  kind: TaxonomyTermKind = 'TOPIC',
): TaxonomyTermSeedRow[] {
  const rows: TaxonomyTermSeedRow[] = [];
  const seen = new Set<string>();
  for (const raw of candidateLabels) {
    const label = String(raw ?? '').trim();
    if (!label) continue;
    const normalizedLabel = normalizeTaxonomyLabel(label);
    if (!normalizedLabel) continue;
    if (approvedNormalizedLabels.has(normalizedLabel) || seen.has(normalizedLabel)) continue;
    seen.add(normalizedLabel);
    rows.push({
      schemaVersion: taxonomyTermSchemaVersion.currentVersion,
      kind,
      label,
      normalizedLabel,
      aliases: [],
      reviewStatus: 'UNREVIEWED',
      status: 'ACTIVE',
      archived: false,
    });
  }
  return rows;
}

export interface ResearchAreaCollapseSimulation {
  entitiesConsidered: number;
  entitiesWithAreas: number;
  entitiesWithCanonicalizedAreaChange: number;
  distinctRawAreasBefore: number;
  distinctCanonicalAreasAfter: number;
  distinctFallThroughToRaw: number;
  distinctLeakageDropped: number;
  leakageDroppedOccurrences: number;
  candidateLabels: string[];
}

function normalizeDistinctKey(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function dedupeInOrder(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

/**
 * Read-only simulation of applying the approved-seed canonicalizer across the
 * corpus's existing `researchAreas[]` strings. Reports the distinct-count
 * collapse, per-entity change count, leakage dropped, and the residual
 * fall-through strings that become UNREVIEWED candidates. Performs no writes.
 */
export function simulateResearchAreaCollapse(
  canonicalizer: ResearchAreaCanonicalizer,
  entityAreaLists: ReadonlyArray<readonly string[]>,
): ResearchAreaCollapseSimulation {
  const distinctRawBefore = new Set<string>();
  const distinctCanonicalAfter = new Set<string>();
  const distinctFallThrough = new Set<string>();
  const distinctLeakage = new Set<string>();
  const candidateByKey = new Map<string, string>();
  let entitiesWithAreas = 0;
  let entitiesWithCanonicalizedAreaChange = 0;
  let leakageDroppedOccurrences = 0;

  for (const list of entityAreaLists) {
    const before = dedupeInOrder(Array.isArray(list) ? [...list] : []);
    for (const value of before) distinctRawBefore.add(normalizeDistinctKey(value));
    if (before.length > 0) entitiesWithAreas += 1;

    const result = canonicalizer.canonicalizeResearchAreas([...(Array.isArray(list) ? list : [])]);
    for (const value of result.values) distinctCanonicalAfter.add(normalizeDistinctKey(value));
    for (const value of result.unmatched) {
      const key = normalizeDistinctKey(value);
      distinctFallThrough.add(key);
      if (!candidateByKey.has(key)) candidateByKey.set(key, value.trim());
    }
    for (const value of result.dropped) {
      leakageDroppedOccurrences += 1;
      distinctLeakage.add(normalizeDistinctKey(value));
    }
    if (!arraysEqual(before, result.values)) entitiesWithCanonicalizedAreaChange += 1;
  }

  const candidateLabels = [...candidateByKey.values()].sort((left, right) =>
    left.localeCompare(right),
  );

  return {
    entitiesConsidered: entityAreaLists.length,
    entitiesWithAreas,
    entitiesWithCanonicalizedAreaChange,
    distinctRawAreasBefore: distinctRawBefore.size,
    distinctCanonicalAreasAfter: distinctCanonicalAfter.size,
    distinctFallThroughToRaw: distinctFallThrough.size,
    distinctLeakageDropped: distinctLeakage.size,
    leakageDroppedOccurrences,
    candidateLabels,
  };
}
