export interface RematerializeResearchEntitiesArgs {
  slugs: string[];
  apply: boolean;
  confirmRematerialize: boolean;
  reclaimStrandedField?: string;
  onlyFields: string[];
  output?: string;
}

export const RECLAIMABLE_STRANDED_FIELDS = ['methods', 'researchAreas'] as const;

export type ReclaimableStrandedField = (typeof RECLAIMABLE_STRANDED_FIELDS)[number];

function parseReclaimStrandedField(value: string | undefined): ReclaimableStrandedField {
  const field = value?.trim();
  if (!field) throw new Error('--reclaim-stranded requires a field name');
  if (!(RECLAIMABLE_STRANDED_FIELDS as readonly string[]).includes(field)) {
    throw new Error(
      `--reclaim-stranded only supports ${RECLAIMABLE_STRANDED_FIELDS.join(', ')} (got: ${field})`,
    );
  }
  return field as ReclaimableStrandedField;
}

export const REMATERIALIZE_TRACKED_FIELDS = [
  'name',
  'displayName',
  'shortDescription',
  'fullDescription',
  'description',
  'summary',
  'researchAreas',
  'methods',
  'websiteUrl',
  'contactUrl',
  'sourceUrls',
  'inferredPiUserId',
  'kind',
  'studentVisibilityTier',
] as const;

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/i;

function parseSlugList(value: string | undefined): string[] {
  if (!value) throw new Error('--slugs requires a comma-separated list of entity slugs');
  const slugs = value
    .split(',')
    .map((slug) => slug.trim())
    .filter(Boolean);
  if (slugs.length === 0) throw new Error('--slugs requires at least one entity slug');
  for (const slug of slugs) {
    if (!SLUG_RE.test(slug)) throw new Error(`Invalid entity slug: ${slug}`);
  }
  return Array.from(new Set(slugs));
}

function parseOnlyFieldsList(value: string | undefined): string[] {
  if (!value) throw new Error('--only-fields requires a comma-separated list of fields');
  const fields = value
    .split(',')
    .map((field) => field.trim())
    .filter(Boolean);
  if (fields.length === 0) throw new Error('--only-fields requires at least one field');
  for (const field of fields) {
    if (!(REMATERIALIZE_TRACKED_FIELDS as readonly string[]).includes(field)) {
      throw new Error(`Unsupported --only-fields field: ${field}`);
    }
  }
  return Array.from(new Set(fields));
}

export function parseRematerializeResearchEntitiesArgs(
  argv: string[],
): RematerializeResearchEntitiesArgs {
  const args: RematerializeResearchEntitiesArgs = {
    slugs: [],
    apply: false,
    confirmRematerialize: false,
    onlyFields: [],
  };
  let slugsProvided = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply' || arg === '--mode=apply') {
      args.apply = true;
      continue;
    }
    if (arg === '--dry-run' || arg === '--mode=dry-run') {
      args.apply = false;
      continue;
    }
    if (arg === '--confirm-rematerialize') {
      args.confirmRematerialize = true;
      continue;
    }
    if (arg.startsWith('--slugs=')) {
      args.slugs = parseSlugList(arg.slice('--slugs='.length));
      slugsProvided = true;
      continue;
    }
    if (arg === '--slugs') {
      args.slugs = parseSlugList(argv[index + 1]);
      slugsProvided = true;
      index += 1;
      continue;
    }
    if (arg.startsWith('--reclaim-stranded=')) {
      args.reclaimStrandedField = parseReclaimStrandedField(
        arg.slice('--reclaim-stranded='.length),
      );
      continue;
    }
    if (arg === '--reclaim-stranded') {
      args.reclaimStrandedField = parseReclaimStrandedField(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith('--only-fields=')) {
      args.onlyFields = parseOnlyFieldsList(arg.slice('--only-fields='.length));
      continue;
    }
    if (arg === '--only-fields') {
      args.onlyFields = parseOnlyFieldsList(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      args.output = arg.slice('--output='.length);
      continue;
    }
    if (arg === '--output') {
      args.output = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown rematerialize argument: ${arg}`);
  }

  if (!slugsProvided && !args.reclaimStrandedField) {
    throw new Error('--slugs or --reclaim-stranded is required');
  }
  return args;
}

export function assertRematerializeApplyAllowed(
  args: RematerializeResearchEntitiesArgs,
  dbLabel: string,
): void {
  if (!args.apply) return;
  if (!args.confirmRematerialize) {
    throw new Error('--confirm-rematerialize is required when --apply is set.');
  }
  if (!/\/development$/i.test(dbLabel)) {
    throw new Error(
      `rematerialize --apply is restricted to the Development database (target: ${dbLabel}).`,
    );
  }
}

export interface RematerializeFieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

function normalizeForComparison(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.map((entry) => normalizeForComparison(entry));
  return value;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return (
    JSON.stringify(normalizeForComparison(left)) === JSON.stringify(normalizeForComparison(right))
  );
}

export function buildRematerializeFieldChanges(
  before: Record<string, unknown>,
  plannedSet: Record<string, unknown>,
  plannedUnset: Record<string, unknown>,
  trackedFields: readonly string[] = REMATERIALIZE_TRACKED_FIELDS,
): RematerializeFieldChange[] {
  const changes: RematerializeFieldChange[] = [];
  for (const field of trackedFields) {
    const beforeValue = before[field];
    let afterValue: unknown;
    if (Object.prototype.hasOwnProperty.call(plannedUnset, field)) {
      afterValue = undefined;
    } else if (Object.prototype.hasOwnProperty.call(plannedSet, field)) {
      afterValue = plannedSet[field];
    } else {
      afterValue = beforeValue;
    }
    if (!valuesEqual(beforeValue, afterValue)) {
      changes.push({ field, before: beforeValue, after: afterValue });
    }
  }
  return changes;
}

export function rematerializeChangeAffectsVisibilityGate(
  changes: RematerializeFieldChange[],
): boolean {
  return changes.some((change) => change.field !== 'studentVisibilityTier');
}

export interface RematerializeRegateCandidate {
  entityId?: string;
  found: boolean;
  skipped?: string;
  changes: RematerializeFieldChange[];
}

export function selectRematerializeRegateEntityIds(
  reports: RematerializeRegateCandidate[],
): string[] {
  const entityIds = new Set<string>();
  for (const report of reports) {
    if (!report.found || report.skipped || !report.entityId) continue;
    if (rematerializeChangeAffectsVisibilityGate(report.changes)) entityIds.add(report.entityId);
  }
  return Array.from(entityIds);
}

export function researchEntityFieldIsStranded(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'string') return value.trim().length === 0;
  return false;
}

export function observationValueIsMaterializable(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) =>
      typeof entry === 'string' ? entry.trim().length > 0 : entry != null,
    );
  }
  if (typeof value === 'string') return value.trim().length > 0;
  return value != null;
}
