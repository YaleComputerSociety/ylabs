import type { ResearchAreaCanonicalizer } from '../scrapers/researchAreaCanonicalization';

export interface ResearchAreaBackfillEntityFacts {
  id: string;
  slug?: string;
  name?: string;
  kind?: string;
  departments?: string[];
  existingResearchAreas?: string[];
  shortDescription?: string;
  fullDescription?: string;
}

export interface ResearchAreaBackfillPlanRow {
  id: string;
  slug?: string;
  name?: string;
  before: string[];
  after: string[];
  added: string[];
  fromExisting: string[];
  fromDepartments: string[];
  fromDescription: string[];
  unmatchedForReview: string[];
  changed: boolean;
}

export interface ResearchAreaBackfillPlanOptions {
  onlyEmpty: boolean;
  maxAreas: number;
}

const DEFAULT_MAX_AREAS = 6;

function cleanList(raw: string[] | undefined): string[] {
  return (raw || [])
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

export function planResearchAreaBackfillRow(
  canonicalizer: ResearchAreaCanonicalizer,
  facts: ResearchAreaBackfillEntityFacts,
  options: ResearchAreaBackfillPlanOptions,
): ResearchAreaBackfillPlanRow {
  const before = cleanList(facts.existingResearchAreas);
  const existing = canonicalizer.canonicalizeResearchAreas(before);
  const hadAreas = before.length > 0;
  const deriveAllowed = !options.onlyEmpty || !hadAreas;

  const textBlob = [
    facts.name,
    facts.shortDescription,
    facts.fullDescription,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n');

  const fromDepartments = deriveAllowed
    ? canonicalizer.matchCanonicalResearchAreas(cleanList(facts.departments))
    : [];
  const fromDescription = deriveAllowed
    ? canonicalizer.deriveResearchAreasFromText(textBlob)
    : [];

  const after: string[] = [];
  const seen = new Set<string>();
  const push = (value: string): void => {
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) return;
    if (after.length >= options.maxAreas) return;
    seen.add(key);
    after.push(value);
  };
  for (const value of existing.values) push(value);
  for (const value of fromDepartments) push(value);
  for (const value of fromDescription) push(value);

  const afterKeys = new Set(after.map((value) => value.toLocaleLowerCase()));
  const existingKeys = new Set(existing.values.map((value) => value.toLocaleLowerCase()));
  const added = after.filter((value) => !existingKeys.has(value.toLocaleLowerCase()));
  const addedFromDepartments = fromDepartments.filter(
    (value) => afterKeys.has(value.toLocaleLowerCase()) && !existingKeys.has(value.toLocaleLowerCase()),
  );
  const addedDepartmentKeys = new Set(
    addedFromDepartments.map((value) => value.toLocaleLowerCase()),
  );
  const addedFromDescription = fromDescription.filter(
    (value) =>
      afterKeys.has(value.toLocaleLowerCase()) &&
      !existingKeys.has(value.toLocaleLowerCase()) &&
      !addedDepartmentKeys.has(value.toLocaleLowerCase()),
  );

  return {
    id: facts.id,
    slug: facts.slug,
    name: facts.name,
    before,
    after,
    added,
    fromExisting: existing.values,
    fromDepartments: addedFromDepartments,
    fromDescription: addedFromDescription,
    unmatchedForReview: existing.unmatched,
    changed: !arraysEqual(before, after),
  };
}

export interface ResearchAreaBackfillSummary {
  considered: number;
  changed: number;
  filledFromEmpty: number;
  areasAdded: number;
  reviewQueue: Array<{ value: string; count: number }>;
}

export function summarizeResearchAreaBackfill(
  rows: ResearchAreaBackfillPlanRow[],
): ResearchAreaBackfillSummary {
  const reviewCounts = new Map<string, number>();
  let changed = 0;
  let filledFromEmpty = 0;
  let areasAdded = 0;
  for (const row of rows) {
    if (row.changed) changed += 1;
    if (row.before.length === 0 && row.after.length > 0) filledFromEmpty += 1;
    areasAdded += row.added.length;
    for (const value of row.unmatchedForReview) {
      reviewCounts.set(value, (reviewCounts.get(value) || 0) + 1);
    }
  }
  const reviewQueue = [...reviewCounts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
  return {
    considered: rows.length,
    changed,
    filledFromEmpty,
    areasAdded,
    reviewQueue,
  };
}

export function normalizeMaxAreas(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return DEFAULT_MAX_AREAS;
  return Math.floor(value);
}
