import { OrgUnit, type OrgUnitKind } from '../models/orgUnit';
import { slugify } from './utils/scraperHelpers';

export interface OrgUnitCanonical {
  name: string;
  slug: string;
  kind: OrgUnitKind;
}

export interface OrgUnitCanonicalizer {
  canonicalizeSchool(raw: unknown): { value: string; matched: boolean };
  canonicalizeDepartments(raw: unknown): { values: string[]; unmatched: string[] };
}

interface OrgUnitResolverRow {
  slug: string;
  name: string;
  kind: OrgUnitKind;
  aliases?: string[];
}

const SCHOOL_KINDS: OrgUnitKind[] = ['SCHOOL', 'DIVISION'];
const DEPARTMENT_KINDS: OrgUnitKind[] = ['DEPARTMENT', 'DIVISION', 'OFFICE'];

/**
 * Deterministic match key for a scraped school or department string. slugify
 * handles case, diacritics, punctuation, and ampersands; the extra affix
 * stripping collapses only unambiguous department qualifiers ("Department of X",
 * "X Department", a leading article) so the fragments the product sees - for
 * example "Dept. of Neuroscience" and "Neuroscience" - resolve to one key. It
 * deliberately does not strip "center of", "institute of", or "program of"
 * because those are legitimate entity names rather than qualifiers.
 */
export function orgUnitMatchKey(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let key = slugify(raw);
  key = key.replace(/^the-/, '');
  key = key.replace(/^(?:department|dept|div|division)-of-/, '');
  key = key.replace(/^(?:department|dept)-/, '');
  key = key.replace(/-(?:department|dept)$/, '');
  return key;
}

/**
 * Deterministic normalized-key -> canonical OrgUnit index over each row's name,
 * slug, and aliases. Earlier rows win on a key collision, so callers that want
 * schools to take precedence must order school rows first.
 */
export function buildOrgUnitResolverIndex(
  rows: OrgUnitResolverRow[],
): Map<string, OrgUnitCanonical> {
  const index = new Map<string, OrgUnitCanonical>();
  for (const row of rows) {
    const canonical: OrgUnitCanonical = { name: row.name, slug: row.slug, kind: row.kind };
    for (const value of [row.name, row.slug, ...(row.aliases || [])]) {
      const key = orgUnitMatchKey(value);
      if (key && !index.has(key)) index.set(key, canonical);
    }
  }
  return index;
}

export function resolveOrgUnitCanonical(
  index: Map<string, OrgUnitCanonical>,
  raw: unknown,
  kinds?: OrgUnitKind[],
): OrgUnitCanonical | null {
  const key = orgUnitMatchKey(raw);
  if (!key) return null;
  const hit = index.get(key);
  if (!hit) return null;
  if (kinds && !kinds.includes(hit.kind)) return null;
  return hit;
}

function toRawList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((value): value is string => typeof value === 'string');
  if (typeof raw === 'string') return [raw];
  return [];
}

/**
 * Wraps a resolver index in the fail-closed school/department canonicalizers the
 * materializer applies at ingest. Any value that does not resolve is kept as its
 * trimmed raw string so a missing OrgUnit never silently drops or guesses a
 * department, matching the evidence-first write posture.
 */
export function createOrgUnitCanonicalizer(
  index: Map<string, OrgUnitCanonical>,
): OrgUnitCanonicalizer {
  return {
    canonicalizeSchool(raw) {
      if (typeof raw !== 'string') return { value: '', matched: false };
      const trimmed = raw.trim();
      if (!trimmed) return { value: trimmed, matched: false };
      const hit = resolveOrgUnitCanonical(index, trimmed, SCHOOL_KINDS);
      return hit ? { value: hit.name, matched: true } : { value: trimmed, matched: false };
    },
    canonicalizeDepartments(raw) {
      const values: string[] = [];
      const unmatched: string[] = [];
      const seen = new Set<string>();
      for (const entry of toRawList(raw)) {
        const trimmed = entry.trim();
        if (!trimmed) continue;
        const hit = resolveOrgUnitCanonical(index, trimmed, DEPARTMENT_KINDS);
        const canonical = hit ? hit.name : trimmed;
        if (!hit) unmatched.push(trimmed);
        const dedupeKey = canonical.toLocaleLowerCase();
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        values.push(canonical);
      }
      return { values, unmatched };
    },
  };
}

let cachedCanonicalizer: OrgUnitCanonicalizer | null = null;

export function resetOrgUnitCanonicalizerCache(): void {
  cachedCanonicalizer = null;
}

export function setOrgUnitCanonicalizerForTesting(canonicalizer: OrgUnitCanonicalizer | null): void {
  cachedCanonicalizer = canonicalizer;
}

async function buildCanonicalizerFromDatabase(): Promise<OrgUnitCanonicalizer> {
  const rows = await OrgUnit.find({
    archived: { $ne: true },
    status: { $ne: 'INACTIVE' },
  })
    .select({ slug: 1, name: 1, kind: 1, aliases: 1 })
    .lean<OrgUnitResolverRow[]>();
  const schoolsFirst = [...rows].sort((left, right) => {
    const leftIsSchool = left.kind === 'SCHOOL' || left.kind === 'DIVISION' ? 0 : 1;
    const rightIsSchool = right.kind === 'SCHOOL' || right.kind === 'DIVISION' ? 0 : 1;
    return leftIsSchool - rightIsSchool;
  });
  return createOrgUnitCanonicalizer(buildOrgUnitResolverIndex(schoolsFirst));
}

export async function getOrgUnitCanonicalizer(): Promise<OrgUnitCanonicalizer> {
  if (!cachedCanonicalizer) {
    cachedCanonicalizer = await buildCanonicalizerFromDatabase();
  }
  return cachedCanonicalizer;
}

/**
 * Canonicalizes a research-entity materialization `$set` in place: the scalar
 * `school` and the `departments[]` strings are rewritten to their canonical
 * OrgUnit names when they resolve, and left as raw values otherwise. Never
 * throws - a canonicalization failure or an unseeded `org_units` collection
 * leaves the raw scraped values untouched so materialization keeps working.
 */
export async function applyResearchEntityOrgUnitCanonicalization(
  set: Record<string, unknown>,
): Promise<{ unmatchedSchool?: string; unmatchedDepartments: string[] }> {
  const result: { unmatchedSchool?: string; unmatchedDepartments: string[] } = {
    unmatchedDepartments: [],
  };
  const hasSchool = Object.prototype.hasOwnProperty.call(set, 'school');
  const hasDepartments = Object.prototype.hasOwnProperty.call(set, 'departments');
  if (!hasSchool && !hasDepartments) return result;

  try {
    const canonicalizer = await getOrgUnitCanonicalizer();
    if (hasSchool && typeof set.school === 'string' && set.school.trim()) {
      const canonical = canonicalizer.canonicalizeSchool(set.school);
      set.school = canonical.value;
      if (!canonical.matched) result.unmatchedSchool = canonical.value;
    }
    if (hasDepartments && Array.isArray(set.departments)) {
      const canonical = canonicalizer.canonicalizeDepartments(set.departments);
      set.departments = canonical.values;
      result.unmatchedDepartments = canonical.unmatched;
    }
  } catch {
    return result;
  }

  return result;
}
