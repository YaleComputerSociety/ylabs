export const RETIRE_DEAD_PROGRAM_LANES_SCRIPT_NAME = 'observations:retire-dead-program-lanes';

export const RETIRE_DEAD_PROGRAM_LANES_ROLLBACK_REASON =
  'enrichment-only observation lane whose recorded entityId points at a deleted research entity with no merge redirect; subject survives as a live fellowship (#2406)';

export const RETIRE_DEAD_PROGRAM_LANES_KEY_PREFIX = 'program-';

export const MINT_INTENT_FIELDS = ['name', 'entityType'] as const;

export interface RetireDeadProgramLanesArgs {
  apply: boolean;
  confirm: boolean;
  maxApply: number;
  output?: string;
}

export function parseRetireDeadProgramLanesArgs(argv: string[]): RetireDeadProgramLanesArgs {
  const args: RetireDeadProgramLanesArgs = { apply: false, confirm: false, maxApply: 200 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply' || arg === '--mode=apply') args.apply = true;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') args.apply = false;
    else if (arg === '--confirm-retire-dead-program-lanes') args.confirm = true;
    else if (arg.startsWith('--max-apply=')) {
      args.maxApply = parsePositiveInteger(arg.slice('--max-apply='.length));
    } else if (arg === '--max-apply') {
      args.maxApply = parsePositiveInteger(argv[(index += 1)]);
    } else if (arg.startsWith('--output=')) args.output = arg.slice('--output='.length);
    else if (arg === '--output') args.output = argv[(index += 1)];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function parsePositiveInteger(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error('--max-apply must be a safe positive integer');
  }
  return parsed;
}

export const squashSubject = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The `fellowships` model has no `name` and no `slug` - the human label is `title`
 * (#2406). Reading `name` here returns undefined for every row and reports a
 * confident zero match, which is the same failure mode as joining
 * `research_entity_redirects.fromSlug`: a field that does not exist yields an
 * empty result that reads as a measurement.
 */
export interface FellowshipSubject {
  title: string;
  sourceUrl: string;
  archived: boolean;
}

export interface FellowshipSubjectMatch {
  title: string;
  archived: boolean;
  matchedBy: 'exact' | 'contained' | 'sourceUrl';
}

export function matchFellowshipSubject(input: {
  entityKey: string;
  observationSourceUrls: readonly string[];
  fellowships: readonly FellowshipSubject[];
}): FellowshipSubjectMatch | undefined {
  const subject = squashSubject(
    input.entityKey.replace(new RegExp(`^${RETIRE_DEAD_PROGRAM_LANES_KEY_PREFIX}`), ''),
  );
  if (!subject) return undefined;

  const candidates = input.fellowships
    .map((fellowship) => ({ fellowship, squashed: squashSubject(fellowship.title) }))
    .filter((candidate) => candidate.squashed.length > 0);

  const exact = candidates.find((candidate) => candidate.squashed === subject);
  if (exact) {
    return {
      title: exact.fellowship.title,
      archived: exact.fellowship.archived,
      matchedBy: 'exact',
    };
  }

  const contained = candidates.find(
    (candidate) =>
      candidate.squashed.length > 10 &&
      (subject.includes(candidate.squashed) || candidate.squashed.includes(subject)),
  );
  if (contained) {
    return {
      title: contained.fellowship.title,
      archived: contained.fellowship.archived,
      matchedBy: 'contained',
    };
  }

  const urls = new Set(input.observationSourceUrls.filter(Boolean));
  const byUrl = candidates.find(
    (candidate) => candidate.fellowship.sourceUrl && urls.has(candidate.fellowship.sourceUrl),
  );
  if (byUrl) {
    return {
      title: byUrl.fellowship.title,
      archived: byUrl.fellowship.archived,
      matchedBy: 'sourceUrl',
    };
  }

  return undefined;
}

export type RetireLaneVerdict =
  | 'retire'
  | 'skip-not-program-key'
  | 'skip-no-recorded-entity-id'
  | 'skip-entity-still-exists'
  | 'skip-redirect-covers-key'
  | 'skip-carries-mint-intent'
  | 'skip-would-materialize'
  | 'skip-referenced-by-durable-record'
  | 'skip-no-fellowship-subject'
  | 'skip-fellowship-subject-archived';

export interface RetireLaneContext {
  entityKey: string;
  observedFields: readonly string[];
  hasRecordedEntityId: boolean;
  entityExists: boolean;
  redirectCoversKey: boolean;
  wouldMaterialize: boolean;
  referencedByDurableRecord: boolean;
  fellowshipMatch?: FellowshipSubjectMatch;
}

/**
 * Fails closed: every condition must be affirmatively satisfied to reach `retire`.
 *
 * `skip-carries-mint-intent` is the load-bearing one and is NOT the reason #2406
 * recorded. The issue argued materialization is a no-op via the retired-`PROGRAM`
 * guard, but none of this population carries an `entityType` observation at all,
 * so `winningObservedEntityTypeIsRetiredProgram` returns false on an empty set and
 * neither PROGRAM branch fires. The real protection is that a lane with no `name`
 * and no `entityType` expresses no intent to mint anything.
 *
 * `skip-fellowship-subject-archived` defers rather than passes: an archived
 * fellowship is not student-facing, so retiring the lane would leave the only
 * surviving trace of a real program in an archived row, which is not what the
 * "subject survives in fellowships" precondition was protecting.
 */
export function retireLaneVerdict(context: RetireLaneContext): RetireLaneVerdict {
  if (!context.entityKey.startsWith(RETIRE_DEAD_PROGRAM_LANES_KEY_PREFIX)) {
    return 'skip-not-program-key';
  }
  if (!context.hasRecordedEntityId) return 'skip-no-recorded-entity-id';
  if (context.entityExists) return 'skip-entity-still-exists';
  if (context.redirectCoversKey) return 'skip-redirect-covers-key';
  if (context.observedFields.some((field) => MINT_INTENT_FIELDS.includes(field as never))) {
    return 'skip-carries-mint-intent';
  }
  if (context.wouldMaterialize) return 'skip-would-materialize';
  if (context.referencedByDurableRecord) return 'skip-referenced-by-durable-record';
  if (!context.fellowshipMatch) return 'skip-no-fellowship-subject';
  if (context.fellowshipMatch.archived) return 'skip-fellowship-subject-archived';
  return 'retire';
}
