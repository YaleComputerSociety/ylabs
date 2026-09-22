/**
 * Selection and reporting for `observations:materialize-profile-page-joined-users`.
 *
 * The official-profile-page join added for #2325 only fires while a scrape ingests
 * `user` observations, so a corpus that already holds the evidence has no way to act on
 * it. This visits the keys that join, and nothing else.
 *
 * Selection never restates the materializer's precedence. The engine reports which key
 * reached the person as `identityJoin`, so a dry-run pass decides the apply set: a key
 * is in scope only when the engine itself says `official-profile-page` resolved it.
 * Re-deriving "would the page join fire" from the corpus is how a lane comes to
 * disagree with the engine about who is reachable, which is the defect #2325 describes.
 */

export type ProfilePageJoinOutcome =
  | 'joined-and-enriched'
  | 'joined-no-change'
  | 'joined-only-in-dry-run'
  | 'reached-by-another-join'
  | 'unreachable'
  | 'error';

export interface ProfilePageJoinRow {
  entityKey: string;
  outcome: ProfilePageJoinOutcome;
  identityJoin?: string;
  skippedReason?: string;
  fieldsWritten: number;
  researcherId?: string;
  error?: string;
}

export interface MaterializeProfilePageJoinedUsersArgs {
  apply: boolean;
  confirmed: boolean;
  limit?: number;
  output?: string;
}

export const PROFILE_PAGE_JOIN_CONFIRM_FLAG = '--confirm-materialize-profile-page-joined-users';
export const PROFILE_PAGE_JOIN_IDENTITY = 'official-profile-page';

export function parseMaterializeProfilePageJoinedUsersArgs(
  argv: readonly string[],
): MaterializeProfilePageJoinedUsersArgs {
  const args: MaterializeProfilePageJoinedUsersArgs = { apply: false, confirmed: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply' || arg === '--mode=apply') args.apply = true;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') args.apply = false;
    else if (arg === PROFILE_PAGE_JOIN_CONFIRM_FLAG) args.confirmed = true;
    else if (arg.startsWith('--limit='))
      args.limit = parsePositiveInteger(arg.slice('--limit='.length));
    else if (arg === '--limit') args.limit = parsePositiveInteger(argv[(index += 1)]);
    else if (arg.startsWith('--output=')) args.output = arg.slice('--output='.length).trim();
    else if (arg === '--output') args.output = String(argv[(index += 1)] ?? '').trim();
  }
  if (args.apply && !args.confirmed) {
    throw new Error(`${PROFILE_PAGE_JOIN_CONFIRM_FLAG} is required when --apply is set.`);
  }
  return args;
}

function parsePositiveInteger(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received: ${String(value)}`);
  }
  return parsed;
}

/**
 * `outcome` reads the engine's own report rather than a counter this module keeps.
 * `fieldsWritten` is a plan in dry run and a write under `--apply`, so the two are
 * named apart: #2440 records a repair queue whose single counter overstated what it
 * had delivered.
 */
export function classifyProfilePageJoinOutcome(
  result: { identityJoin?: string; skipped?: string; fieldsWritten?: number },
  options: { apply: boolean },
): ProfilePageJoinOutcome {
  if (result.skipped) return 'unreachable';
  if (result.identityJoin !== PROFILE_PAGE_JOIN_IDENTITY) return 'reached-by-another-join';
  if (!options.apply) return 'joined-only-in-dry-run';
  return (result.fieldsWritten ?? 0) > 0 ? 'joined-and-enriched' : 'joined-no-change';
}

export function summarizeProfilePageJoinRows(rows: readonly ProfilePageJoinRow[]): {
  outcomes: Record<ProfilePageJoinOutcome, number>;
  fieldsWritten: number;
  distinctResearchers: number;
} {
  const outcomes: Record<ProfilePageJoinOutcome, number> = {
    'joined-and-enriched': 0,
    'joined-no-change': 0,
    'joined-only-in-dry-run': 0,
    'reached-by-another-join': 0,
    unreachable: 0,
    error: 0,
  };
  let fieldsWritten = 0;
  const researchers = new Set<string>();
  for (const row of rows) {
    outcomes[row.outcome] += 1;
    fieldsWritten += row.fieldsWritten;
    if (row.researcherId) researchers.add(row.researcherId);
  }
  return { outcomes, fieldsWritten, distinctResearchers: researchers.size };
}
