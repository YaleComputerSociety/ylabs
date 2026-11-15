import { REMATERIALIZE_TRACKED_FIELDS } from './rematerializeResearchEntitiesCore';

export const MERGE_SURVIVOR_ONLY_FIELDS_FLAG = '--only-fields';

export const SURVIVOR_REMATERIALIZE_PASSES = 2;

export interface SurvivorRematerializeOptions {
  writeOnlyFields: string[];
  keepPostProjectionEvidence: true;
}

export type SurvivorMaterialize = (
  entityType: 'researchEntity',
  query: { entityKey: string },
  options: SurvivorRematerializeOptions,
) => Promise<unknown>;

export function parseMergeSurvivorOnlyFields(value: string | undefined): string[] {
  if (!value) {
    throw new Error(`${MERGE_SURVIVOR_ONLY_FIELDS_FLAG} requires a comma-separated list of fields`);
  }
  const fields = Array.from(
    new Set(
      value
        .split(',')
        .map((field) => field.trim())
        .filter(Boolean),
    ),
  );
  if (fields.length === 0) {
    throw new Error(`${MERGE_SURVIVOR_ONLY_FIELDS_FLAG} requires at least one field`);
  }
  for (const field of fields) {
    if (!(REMATERIALIZE_TRACKED_FIELDS as readonly string[]).includes(field)) {
      throw new Error(`Unsupported ${MERGE_SURVIVOR_ONLY_FIELDS_FLAG} field: ${field}`);
    }
  }
  return fields;
}

export function assertScopedSurvivorApply(input: {
  apply: boolean;
  onlyFields: readonly string[] | undefined;
  scriptName: string;
}): void {
  if (input.apply && (!input.onlyFields || input.onlyFields.length === 0)) {
    throw new Error(
      `${input.scriptName} apply requires ${MERGE_SURVIVOR_ONLY_FIELDS_FLAG}=<list>: an unscoped survivor rematerialize writes every tracked field (#6296)`,
    );
  }
}

export function survivorRematerializeOptions(
  onlyFields: readonly string[],
): SurvivorRematerializeOptions {
  if (onlyFields.length === 0) {
    throw new Error('A survivor rematerialize needs at least one scoped field (#6296)');
  }
  return { writeOnlyFields: [...onlyFields], keepPostProjectionEvidence: true };
}

export async function rematerializeMergeSurvivors(input: {
  survivorSlugs: readonly string[];
  onlyFields: readonly string[];
  materialize: SurvivorMaterialize;
}): Promise<number> {
  const options = survivorRematerializeOptions(input.onlyFields);
  let rematerializations = 0;
  for (let pass = 0; pass < SURVIVOR_REMATERIALIZE_PASSES; pass += 1) {
    for (const slug of input.survivorSlugs) {
      await input.materialize('researchEntity', { entityKey: slug }, options);
      rematerializations += 1;
    }
  }
  return rematerializations;
}

export interface ScopedSurvivorPlan {
  slug: string;
  plannedSetPaths: string[];
  plannedUnsetPaths: string[];
  changedFields: string[];
}

const withoutSubdocumentIds = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutSubdocumentIds);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => key !== '_id')
        .sort()
        .map((key) => [key, withoutSubdocumentIds((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
};

const comparable = (value: unknown): string =>
  JSON.stringify(withoutSubdocumentIds(JSON.parse(JSON.stringify(value ?? null))));

export function changedTopLevelFields(
  current: Record<string, unknown> | null,
  plannedSet: Record<string, unknown>,
  plannedUnset: Record<string, unknown>,
): string[] {
  const changed = new Set<string>();
  for (const [path, value] of Object.entries(plannedSet)) {
    if (path.includes('.')) continue;
    if (comparable(current?.[path]) !== comparable(value)) changed.add(path);
  }
  for (const path of Object.keys(plannedUnset)) {
    if (path.includes('.')) continue;
    if (current?.[path] !== undefined) changed.add(path);
  }
  return [...changed].sort();
}

export async function planScopedSurvivorRematerialize(input: {
  survivorSlugs: readonly string[];
  onlyFields: readonly string[];
  materialize: (
    entityType: 'researchEntity',
    query: { entityKey: string },
    options: SurvivorRematerializeOptions & { dryRun: true },
  ) => Promise<{ plannedSet?: Record<string, unknown>; plannedUnset?: Record<string, unknown> }>;
  loadCurrent: (slug: string) => Promise<Record<string, unknown> | null>;
}): Promise<ScopedSurvivorPlan[]> {
  const options = { ...survivorRematerializeOptions(input.onlyFields), dryRun: true as const };
  const plans: ScopedSurvivorPlan[] = [];
  for (const slug of input.survivorSlugs) {
    const current = await input.loadCurrent(slug);
    const result = await input.materialize('researchEntity', { entityKey: slug }, options);
    const plannedSet = result.plannedSet ?? {};
    const plannedUnset = result.plannedUnset ?? {};
    plans.push({
      slug,
      plannedSetPaths: Object.keys(plannedSet).sort(),
      plannedUnsetPaths: Object.keys(plannedUnset).sort(),
      changedFields: changedTopLevelFields(current, plannedSet, plannedUnset),
    });
  }
  return plans;
}
