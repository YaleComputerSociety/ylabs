import { OrgUnit, type OrgUnitKind } from '../models/orgUnit';
import { slugify } from './utils/scraperHelpers';

export interface OrgUnitCanonical {
  name: string;
  slug: string;
  kind: OrgUnitKind;
}

export interface OrgUnitCanonicalizer {
  canonicalizeSchool(raw: unknown): { value: string; matched: boolean };
  canonicalizeDepartments(raw: unknown): {
    values: string[];
    unmatched: string[];
    dropped: string[];
  };
  /** Canonical school name a canonical department belongs to, or null. */
  schoolForDepartment(canonicalDepartmentName: string): string | null;
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

const LEADING_ORG_CODE_PATTERN = /^([A-Z][A-Z0-9]{1,6})\s+(?=.*[a-z])(.+)$/;

/**
 * Strips a leading Yale HR/directory org code (an opaque all-caps token such as
 * "PRVAIT" or "EASBME") from a scraped org-unit string, leaving the human name.
 * The lowercase lookahead guards fully-uppercase names ("SOCIAL SCIENCES") from
 * having a leading word mistaken for a code.
 */
export function denoiseOrgUnitValue(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  const match = trimmed.match(LEADING_ORG_CODE_PATTERN);
  if (!match) return trimmed;
  const remainder = match[2].trim();
  return remainder.length >= 3 ? remainder : trimmed;
}

/**
 * Administrative / non-research org units that reach `research_entities.departments`
 * as raw HR-directory strings and must never surface as a student-facing department
 * facet value. Matched by normalized key so raw casing and the org-code prefix both
 * resolve; dropping fails closed - only these explicitly reviewed units are removed.
 */
export const ADMINISTRATIVE_ORG_UNIT_VALUES = [
  'Administration',
  'None',
  'Social Sciences',
  'Veterinary Sciences',
  'DIVFIN Divinity General',
  'DRAADM Business Office',
  'ENVACC Research',
  'ENVOTH Other Units',
  'FAS Other FAS and Academic Departments',
  'FASFDA FAS Dean Administration',
  'GRA Graduate School',
  'ISMADM Finance and Administration',
  'PRV Provost Administration',
  'PRVADM Provost Admin',
  'PRVAIT Henry Koerner Center for Emeritus Faculty Dept',
  'PRVAIT Institution for Social and Policy Studies (ISPS)',
  'YCO Yale College Operating Units',
  'YCORCH Jonathan Edwards Head of College',
] as const;

const ADMINISTRATIVE_ORG_UNIT_KEYS = new Set(
  ADMINISTRATIVE_ORG_UNIT_VALUES.map((value) => orgUnitMatchKey(value)).filter(Boolean),
);

export function isDroppedAdministrativeOrgUnit(raw: unknown): boolean {
  const key = orgUnitMatchKey(raw);
  if (key && ADMINISTRATIVE_ORG_UNIT_KEYS.has(key)) return true;
  const denoised = denoiseOrgUnitValue(raw);
  if (typeof raw === 'string' && denoised && denoised !== raw.trim()) {
    const denoisedKey = orgUnitMatchKey(denoised);
    if (denoisedKey && ADMINISTRATIVE_ORG_UNIT_KEYS.has(denoisedKey)) return true;
  }
  return false;
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

function resolvesToSchool(
  index: Map<string, OrgUnitCanonical>,
  raw: string,
  denoised: string,
): boolean {
  if (resolveOrgUnitCanonical(index, raw, SCHOOL_KINDS)) return true;
  if (denoised && denoised !== raw && resolveOrgUnitCanonical(index, denoised, SCHOOL_KINDS)) {
    return true;
  }
  return false;
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
  departmentToSchool: Map<string, string> = new Map(),
): OrgUnitCanonicalizer {
  return {
    schoolForDepartment(canonicalDepartmentName) {
      return departmentToSchool.get(canonicalDepartmentName) ?? null;
    },
    canonicalizeSchool(raw) {
      if (typeof raw !== 'string') return { value: '', matched: false };
      const trimmed = raw.trim();
      if (!trimmed) return { value: trimmed, matched: false };
      const hit = resolveOrgUnitCanonical(index, trimmed, SCHOOL_KINDS);
      return hit ? { value: hit.name, matched: true } : { value: trimmed, matched: false };
    },
    canonicalizeDepartments(raw) {
      const entries = toRawList(raw);
      const values: string[] = [];
      const unmatched: string[] = [];
      const dropped: string[] = [];
      const seen = new Set<string>();
      for (const entry of entries) {
        const trimmed = entry.trim();
        if (!trimmed) continue;
        if (isDroppedAdministrativeOrgUnit(trimmed)) {
          dropped.push(trimmed);
          continue;
        }
        let hit = resolveOrgUnitCanonical(index, trimmed, DEPARTMENT_KINDS);
        let fallback = trimmed;
        if (!hit) {
          const denoised = denoiseOrgUnitValue(trimmed);
          if (denoised && denoised !== trimmed) {
            hit = resolveOrgUnitCanonical(index, denoised, DEPARTMENT_KINDS);
            fallback = denoised;
          }
          // A school (School of Medicine) is not a peer of a department
          // (Genetics, Immunobiology): a value that only resolves to a school,
          // whether alone or alongside a real department, is never a valid
          // department-facet value and is dropped rather than kept raw (#1384).
          if (!hit && resolvesToSchool(index, trimmed, denoised)) {
            dropped.push(trimmed);
            continue;
          }
        }
        const canonical = hit ? hit.name : fallback;
        if (!hit) unmatched.push(canonical);
        const dedupeKey = canonical.toLocaleLowerCase();
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        values.push(canonical);
      }
      return { values, unmatched, dropped };
    },
  };
}

let cachedCanonicalizer: OrgUnitCanonicalizer | null = null;

export function resetOrgUnitCanonicalizerCache(): void {
  cachedCanonicalizer = null;
}

export function setOrgUnitCanonicalizerForTesting(
  canonicalizer: OrgUnitCanonicalizer | null,
): void {
  cachedCanonicalizer = canonicalizer;
}

interface OrgUnitParentRow extends OrgUnitResolverRow {
  _id: unknown;
  parentOrgUnitId?: unknown;
}

/**
 * Maps each department's canonical name to its school by walking
 * parentOrgUnitId up to the nearest SCHOOL or DIVISION.
 */
export function buildDepartmentToSchoolMap(rows: OrgUnitParentRow[]): Map<string, string> {
  const byId = new Map(rows.map((row) => [String(row._id), row]));
  const schoolNameFor = (row: OrgUnitParentRow): string | null => {
    const seen = new Set<string>();
    let current: OrgUnitParentRow | undefined = row;
    while (current) {
      if (current.kind === 'SCHOOL' || current.kind === 'DIVISION') return current.name;
      const parentId = current.parentOrgUnitId ? String(current.parentOrgUnitId) : '';
      if (!parentId || seen.has(parentId)) break;
      seen.add(parentId);
      current = byId.get(parentId);
    }
    return null;
  };
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.kind !== 'DEPARTMENT' && row.kind !== 'OFFICE') continue;
    const school = schoolNameFor(row);
    if (school) map.set(row.name, school);
  }
  return map;
}

async function buildCanonicalizerFromDatabase(): Promise<OrgUnitCanonicalizer> {
  const rows = await OrgUnit.find({
    archived: { $ne: true },
    status: { $ne: 'INACTIVE' },
  })
    .select({ slug: 1, name: 1, kind: 1, aliases: 1, parentOrgUnitId: 1 })
    .lean<OrgUnitParentRow[]>();
  const schoolsFirst = [...rows].sort((left, right) => {
    const leftIsSchool = left.kind === 'SCHOOL' || left.kind === 'DIVISION' ? 0 : 1;
    const rightIsSchool = right.kind === 'SCHOOL' || right.kind === 'DIVISION' ? 0 : 1;
    return leftIsSchool - rightIsSchool;
  });
  return createOrgUnitCanonicalizer(
    buildOrgUnitResolverIndex(schoolsFirst),
    buildDepartmentToSchoolMap(rows),
  );
}

export async function getOrgUnitCanonicalizer(): Promise<OrgUnitCanonicalizer> {
  if (!cachedCanonicalizer) {
    cachedCanonicalizer = await buildCanonicalizerFromDatabase();
  }
  return cachedCanonicalizer;
}

const asStringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/**
 * Yale school subdomains that name exactly one school, so a profile hosted there
 * is first-party evidence of that school. Generic research portals
 * (research.yale.edu), campus locations (westcampus.yale.edu), and cross-school
 * centers are deliberately absent: the host only sets a school when the host
 * itself names one, keeping the fallback fail-closed (issue #1182).
 */
export const SCHOOL_PROFILE_HOSTS: Record<string, string> = {
  'medicine.yale.edu': 'School of Medicine',
  'ysph.yale.edu': 'School of Public Health',
  'nursing.yale.edu': 'School of Nursing',
  'divinity.yale.edu': 'Divinity School',
  'law.yale.edu': 'Law School',
  'som.yale.edu': 'School of Management',
  'environment.yale.edu': 'School of the Environment',
  'art.yale.edu': 'School of Art',
  'architecture.yale.edu': 'School of Architecture',
  'music.yale.edu': 'School of Music',
  'drama.yale.edu': 'David Geffen School of Drama',
};

function hostnameOf(url: unknown): string {
  if (typeof url !== 'string' || !url) return '';
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * The school named by the first profile URL whose host is a school subdomain, or
 * null when no host names a school. Returns the raw mapped name; callers resolve
 * it through the canonicalizer so a school that is not a known OrgUnit fails
 * closed rather than writing an off-catalog value.
 */
export function schoolNameFromProfileHosts(urls: string[]): string | null {
  for (const url of urls) {
    const school = SCHOOL_PROFILE_HOSTS[hostnameOf(url)];
    if (school) return school;
  }
  return null;
}

/**
 * A research entity carries a school but no department that is meaningfully
 * below the school level: either `departments` is empty, or every department
 * value is just one of the entity's own school names (the #1316/#1335 graceful-
 * degradation fallback, which keeps the entity reachable but leaves it
 * un-narrowable below the school). Flagging this shape lets an audit track the
 * professional-school department coverage debt rather than have it silently
 * reappear (issue #1377, fix direction #3 from #1316).
 */
export function researchEntityHasSchoolButNoRealDepartment(entity: {
  school?: unknown;
  schools?: unknown;
  departments?: unknown;
}): boolean {
  const schoolValues = [
    ...(typeof entity.school === 'string' ? [entity.school] : []),
    ...asStringList(entity.schools),
  ];
  const schoolKeys = new Set(schoolValues.map((value) => orgUnitMatchKey(value)).filter(Boolean));
  if (schoolKeys.size === 0) return false;

  const departments = asStringList(entity.departments)
    .map((value) => value.trim())
    .filter(Boolean);
  if (departments.length === 0) return true;

  return departments.every((department) => schoolKeys.has(orgUnitMatchKey(department)));
}

/**
 * Canonicalizes a research-entity materialization `$set` in place: the scalar
 * `school` and the `departments[]` strings are rewritten to their canonical
 * OrgUnit names when they resolve, and left as raw values otherwise. It also
 * derives the multi-valued `schools[]` (the entity's own school plus each
 * department's parent school) so a cross-school lab is filterable under every
 * school it belongs to. When the scalar `school` would otherwise stay empty, it
 * is backfilled from the primary derived school so the singular mirror the
 * client display sites read never desyncs from the canonical `schools[]`.
 * A school is never written into `departments[]` as a substitute for a real
 * department: a school (School of Medicine) is not a peer of a department
 * (Genetics, Immunobiology), so when no real department resolves,
 * `departments[]` is left as-is (typically empty) and the entity stays
 * discoverable through the `school`/`schools[]` facet instead (#1384).
 * `existing` supplies the entity's current school and departments so
 * `schools[]` reflects the merged record when a scrape updates only one of
 * them. Never throws - a canonicalization failure or an unseeded `org_units`
 * collection leaves the raw scraped values untouched so materialization keeps
 * working.
 */
export async function applyResearchEntityOrgUnitCanonicalization(
  set: Record<string, unknown>,
  existing?: Record<string, unknown> | null,
  profileUrls: string[] = [],
): Promise<{
  unmatchedSchool?: string;
  unmatchedDepartments: string[];
  droppedDepartments: string[];
}> {
  const result: {
    unmatchedSchool?: string;
    unmatchedDepartments: string[];
    droppedDepartments: string[];
  } = {
    unmatchedDepartments: [],
    droppedDepartments: [],
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
      result.droppedDepartments = canonical.dropped;
    }

    const effectiveSchool = hasSchool ? set.school : existing?.school;
    // A department value that is itself the entity's own school (e.g. a
    // DIVISION-kind org unit such as "Faculty of Arts and Sciences" that
    // resolves under both SCHOOL_KINDS and DEPARTMENT_KINDS) is the same
    // category error as the retired fallback and is dropped here even though
    // canonicalizeDepartments has no entity context to catch it itself (#1384).
    if (hasDepartments && Array.isArray(set.departments) && typeof effectiveSchool === 'string') {
      const schoolKey = effectiveSchool.trim().toLocaleLowerCase();
      if (schoolKey) {
        const departments = set.departments as string[];
        const selfReferential = departments.filter(
          (department) => department.toLocaleLowerCase() === schoolKey,
        );
        if (selfReferential.length > 0) {
          set.departments = departments.filter(
            (department) => department.toLocaleLowerCase() !== schoolKey,
          );
          result.droppedDepartments = [...result.droppedDepartments, ...selfReferential];
        }
      }
    }
    const effectiveDepartments = hasDepartments
      ? asStringList(set.departments)
      : asStringList(existing?.departments);
    const schools: string[] = [];
    const addSchool = (value: unknown): void => {
      if (typeof value === 'string' && value.trim() && !schools.includes(value))
        schools.push(value);
    };
    if (typeof effectiveSchool === 'string' && effectiveSchool.trim()) {
      addSchool(canonicalizer.canonicalizeSchool(effectiveSchool).value);
    }
    for (const department of effectiveDepartments) {
      addSchool(canonicalizer.schoolForDepartment(department));
    }

    const scalarSchool = typeof effectiveSchool === 'string' ? effectiveSchool.trim() : '';
    if (schools.length === 0 && !scalarSchool && profileUrls.length > 0) {
      const hostSchool = schoolNameFromProfileHosts(profileUrls);
      if (hostSchool) {
        const canonical = canonicalizer.canonicalizeSchool(hostSchool);
        if (canonical.matched) addSchool(canonical.value);
      }
    }

    if (schools.length > 0) set.schools = schools;
    if (!scalarSchool && schools.length > 0) set.school = schools[0];
  } catch {
    return result;
  }

  return result;
}
