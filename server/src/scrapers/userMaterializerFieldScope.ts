import { isDeepStrictEqual } from 'node:util';
import {
  RESEARCHER_WRITER_FIELDS,
  type ResearcherWriterField,
} from '../utils/researcherFieldWriters';

export const PROFILE_FIELD_WRITERS_PATH = 'profileFieldWriters';

export const USER_MATERIALIZER_SCOPE_FIELDS = [
  'displayName',
  'profile.title',
  'profile.primaryDepartment',
  'profile.imageUrl',
  'profile.websiteUrl',
  'identifiers.email',
  'identifiers.emailSupport',
  'profileLinks',
  PROFILE_FIELD_WRITERS_PATH,
  ...RESEARCHER_WRITER_FIELDS.map((field) => `${PROFILE_FIELD_WRITERS_PATH}.${field}`),
] as const;

export const USER_MATERIALIZER_FIELD_ALIASES: Readonly<Record<string, string>> = {
  email: 'identifiers.email',
  emailSupport: 'identifiers.emailSupport',
  title: 'profile.title',
  primaryDepartment: 'profile.primaryDepartment',
  imageUrl: 'profile.imageUrl',
  websiteUrl: 'profile.websiteUrl',
};

/**
 * Paths written together because one is computed from the other. The email support
 * marker records the address it was computed for, so a scope that wrote one without
 * the other would store a marker describing a different address. Symmetric, like
 * `MATERIALIZER_DERIVED_FIELD_GROUPS`.
 */
export const USER_MATERIALIZER_DERIVED_FIELD_GROUPS: ReadonlyArray<readonly string[]> = [
  ['identifiers.email', 'identifiers.emailSupport'],
];

const WRITER_FIELD_BY_VALUE_PATH: Readonly<Record<string, ResearcherWriterField>> = {
  displayName: 'displayName',
  'profile.title': 'title',
  'profile.primaryDepartment': 'primaryDepartment',
  'profile.imageUrl': 'imageUrl',
  'profile.websiteUrl': 'websiteUrl',
};

const SUPPORTED = new Set<string>(USER_MATERIALIZER_SCOPE_FIELDS);

export function canonicalUserMaterializerField(field: string): string | undefined {
  const canonical = USER_MATERIALIZER_FIELD_ALIASES[field] ?? field;
  return SUPPORTED.has(canonical) ? canonical : undefined;
}

export function parseUserOnlyFieldsList(value: string | undefined): string[] {
  if (!value) throw new Error('--only-fields requires a comma-separated list of fields');
  const fields = value
    .split(',')
    .map((field) => field.trim())
    .filter(Boolean);
  if (fields.length === 0) throw new Error('--only-fields requires at least one field');
  const canonical = fields.map((field) => {
    const resolved = canonicalUserMaterializerField(field);
    if (!resolved) {
      throw new Error(
        `Unsupported --only-fields field: ${field}. Supported: ${[
          ...USER_MATERIALIZER_SCOPE_FIELDS,
          ...Object.keys(USER_MATERIALIZER_FIELD_ALIASES),
        ].join(', ')}`,
      );
    }
    return resolved;
  });
  return Array.from(new Set(canonical));
}

// One-directional on purpose: naming `profileFieldWriters` re-records writers without
// pulling in the values they guard (#5816).
export function expandUserMaterializerScope(fields: readonly string[]): string[] {
  const scoped = new Set<string>();
  for (const field of fields) {
    const canonical = canonicalUserMaterializerField(field);
    if (!canonical) throw new Error(`Unsupported user materializer scope field: ${field}`);
    scoped.add(canonical);
  }
  for (const group of USER_MATERIALIZER_DERIVED_FIELD_GROUPS) {
    if (group.some((field) => scoped.has(field))) for (const field of group) scoped.add(field);
  }
  for (const field of [...scoped]) {
    const writerField = WRITER_FIELD_BY_VALUE_PATH[field];
    if (writerField) scoped.add(`${PROFILE_FIELD_WRITERS_PATH}.${writerField}`);
  }
  return Array.from(scoped).sort();
}

export function userScopeAdmits(scope: readonly string[], path: string): boolean {
  return scope.some((field) => path === field || path.startsWith(`${field}.`));
}

const UNTRACKED_TOP_LEVEL_PATHS = new Set(['_id', '__v', 'createdAt', 'updatedAt']);
const LEAF_EXPANDED_PATHS = new Set([
  'profile',
  'identifiers',
  PROFILE_FIELD_WRITERS_PATH,
  'fieldValueRefusals',
]);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  !(value instanceof Date) &&
  Object.getPrototypeOf(value) === Object.prototype;

const comparable = (value: unknown): unknown => {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(comparable);
  if (value instanceof Map) return comparable(Object.fromEntries(value));
  if (typeof value === 'object' && typeof (value as any).toHexString === 'function') {
    return String(value);
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const inner = comparable(value[key]);
      if (inner !== undefined) out[key] = inner;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  return value;
};

export function changedResearcherPaths(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  const changed: string[] = [];
  const topLevel = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of topLevel) {
    if (UNTRACKED_TOP_LEVEL_PATHS.has(key)) continue;
    const left = before[key];
    const right = after[key];
    if (LEAF_EXPANDED_PATHS.has(key)) {
      const leftObject = (comparable(left) ?? {}) as Record<string, unknown>;
      const rightObject = (comparable(right) ?? {}) as Record<string, unknown>;
      for (const inner of new Set([...Object.keys(leftObject), ...Object.keys(rightObject)])) {
        if (!isDeepStrictEqual(leftObject[inner], rightObject[inner])) {
          changed.push(`${key}.${inner}`);
        }
      }
      continue;
    }
    if (!isDeepStrictEqual(comparable(left), comparable(right))) changed.push(key);
  }
  return changed.sort();
}

export function partitionPlannedPaths(
  paths: readonly string[],
  scope: readonly string[],
): { kept: string[]; dropped: string[] } {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const path of paths) (userScopeAdmits(scope, path) ? kept : dropped).push(path);
  return { kept: kept.sort(), dropped: dropped.sort() };
}

export function valueAtPath(document: Record<string, unknown>, path: string): unknown {
  let current: unknown = document;
  for (const segment of path.split('.')) {
    if (current instanceof Map) current = current.get(segment);
    else if (current && typeof current === 'object') {
      current = (current as Record<string, unknown>)[segment];
    } else return undefined;
  }
  return current;
}

export function scopedResearcherUpdate(
  after: Record<string, unknown>,
  paths: readonly string[],
): { $set?: Record<string, unknown>; $unset?: Record<string, ''> } {
  const set: Record<string, unknown> = {};
  const unset: Record<string, ''> = {};
  for (const path of paths) {
    const value = valueAtPath(after, path);
    if (value === undefined || value === null) unset[path] = '';
    else set[path] = value;
  }
  return {
    ...(Object.keys(set).length > 0 ? { $set: set } : {}),
    ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
  };
}
