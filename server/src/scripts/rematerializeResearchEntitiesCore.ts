export interface RematerializeResearchEntitiesArgs {
  slugs: string[];
  apply: boolean;
  confirmRematerialize: boolean;
  output?: string;
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

export function parseRematerializeResearchEntitiesArgs(
  argv: string[],
): RematerializeResearchEntitiesArgs {
  const args: RematerializeResearchEntitiesArgs = {
    slugs: [],
    apply: false,
    confirmRematerialize: false,
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

  if (!slugsProvided) throw new Error('--slugs is required');
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
  return JSON.stringify(normalizeForComparison(left)) === JSON.stringify(normalizeForComparison(right));
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
