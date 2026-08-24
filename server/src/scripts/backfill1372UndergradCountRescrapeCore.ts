/**
 * Pure helpers for the #1372 currentUndergradCount backfill. #1325 fixed the
 * lab-microsite-undergrad-llm extraction path (recency + Yale-affiliation gate
 * on deriveCurrentUndergradCount) but left already-materialized entities
 * carrying pre-fix, ungated counts. These entities are identified by their
 * backing Observation predating the #1325 merge commit.
 */
export const PR_1325_MERGED_AT = new Date('2026-08-24T02:21:29.000Z');

export const BACKFILL_1372_SOURCE_NAME = 'lab-microsite-undergrad-llm';

export const BACKFILL_1372_WRITE_ONLY_FIELDS = ['currentUndergradCount', 'undergradEvidenceQuote'] as const;

export function isLegacyCurrentUndergradCountObservation(observedAt: Date | string | undefined): boolean {
  if (!observedAt) return false;
  const time = observedAt instanceof Date ? observedAt.getTime() : new Date(observedAt).getTime();
  if (!Number.isFinite(time)) return false;
  return time < PR_1325_MERGED_AT.getTime();
}

export interface Backfill1372Args {
  apply: boolean;
  slugs?: string[];
  output?: string;
}

function parseSlugList(value: string | undefined): string[] {
  if (!value) throw new Error('--slugs requires a comma-separated list of entity slugs');
  const slugs = value
    .split(',')
    .map((slug) => slug.trim())
    .filter(Boolean);
  if (slugs.length === 0) throw new Error('--slugs requires at least one entity slug');
  return Array.from(new Set(slugs));
}

export function parseBackfill1372Args(argv: string[]): Backfill1372Args {
  const args: Backfill1372Args = { apply: false };
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
    if (arg.startsWith('--slugs=')) {
      args.slugs = parseSlugList(arg.slice('--slugs='.length));
      continue;
    }
    if (arg === '--slugs') {
      args.slugs = parseSlugList(argv[index + 1]);
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
    throw new Error(`Unknown backfill-1372 argument: ${arg}`);
  }
  return args;
}

export interface CandidateEntitySummary {
  slug: string;
  currentUndergradCount?: number;
  manuallyLockedFields?: string[];
}

/**
 * A legacy-observation slug qualifies as a backfill target only when the
 * currently-materialized entity still carries a positive count and hasn't
 * manually locked it against automated writes.
 */
export function selectBackfillTargetSlugs(
  legacySlugs: Iterable<string>,
  entities: CandidateEntitySummary[],
): string[] {
  const legacySet = new Set(legacySlugs);
  const bySlug = new Map(entities.map((entity) => [entity.slug, entity]));
  const targets: string[] = [];
  for (const slug of legacySet) {
    const entity = bySlug.get(slug);
    if (!entity) continue;
    if (!entity.currentUndergradCount || entity.currentUndergradCount <= 0) continue;
    if ((entity.manuallyLockedFields || []).includes('currentUndergradCount')) continue;
    targets.push(slug);
  }
  return targets.sort();
}
