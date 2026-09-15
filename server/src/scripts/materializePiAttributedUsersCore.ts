/**
 * Selection and reporting for `observations:materialize-pi-attributed-users`.
 *
 * `materializeUserIdentityToResearcher` mints a `Researcher` for a person a live
 * research entity names as its lead (#2773), but that path only runs while a scrape
 * ingests `user` observations. Nothing re-runs it over evidence already stored, and
 * `observations:catch-up-materialize` is hardcoded to `'researchEntity'`, so a
 * corpus that already holds the attribution has no way to act on it without a
 * full re-scrape.
 *
 * Selection is deliberately narrow: a `user` entityKey is a candidate only when a
 * live `inferredPiUserKey` or `inferredPiUserId` observation carries that exact key.
 * The materializer applies every mint guard itself, so this module decides only which
 * keys to visit, never whether one deserves a researcher.
 */

export type PiAttributedUserOutcome = 'minted' | 'would-mint' | 'enriched' | 'refused' | 'error';

export interface PiAttributedUserRow {
  entityKey: string;
  outcome: PiAttributedUserOutcome;
  skippedReason?: string;
  fieldsWritten: number;
  researcherId?: string;
  error?: string;
}

export interface MaterializePiAttributedUsersArgs {
  apply: boolean;
  confirmed: boolean;
  limit?: number;
  output?: string;
}

export const PI_ATTRIBUTED_USERS_CONFIRM_FLAG = '--confirm-materialize-pi-attributed-users';
export const PI_ATTRIBUTION_FIELDS = ['inferredPiUserKey', 'inferredPiUserId'] as const;

export function parseMaterializePiAttributedUsersArgs(
  argv: readonly string[],
): MaterializePiAttributedUsersArgs {
  const args: MaterializePiAttributedUsersArgs = { apply: false, confirmed: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply' || arg === '--mode=apply') args.apply = true;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') args.apply = false;
    else if (arg === PI_ATTRIBUTED_USERS_CONFIRM_FLAG) args.confirmed = true;
    else if (arg.startsWith('--limit='))
      args.limit = parsePositiveInteger(arg.slice('--limit='.length));
    else if (arg === '--limit') args.limit = parsePositiveInteger(argv[(index += 1)]);
    else if (arg.startsWith('--output=')) args.output = arg.slice('--output='.length).trim();
    else if (arg === '--output') args.output = String(argv[(index += 1)] ?? '').trim();
  }
  if (args.apply && !args.confirmed) {
    throw new Error(`${PI_ATTRIBUTED_USERS_CONFIRM_FLAG} is required when --apply is set.`);
  }
  return args;
}

function parsePositiveInteger(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('--limit must be a safe positive integer');
  }
  return parsed;
}

/**
 * A materializer result carries no single "did it mint" flag: `created` is true only
 * on a real write, and a dry run reports the distinct
 * `dry-run-would-mint-researcher` skip instead, so a caller that reads `created`
 * alone cannot tell a refusal from a dry run that would have minted.
 */
export function classifyPiAttributedUserOutcome(result: {
  created?: boolean;
  skipped?: string;
  fieldsWritten?: number;
}): PiAttributedUserOutcome {
  if (result.created) return 'minted';
  if (result.skipped === 'dry-run-would-mint-researcher') return 'would-mint';
  if (result.skipped) return 'refused';
  return 'enriched';
}

export function summarizePiAttributedUserRows(rows: readonly PiAttributedUserRow[]): {
  examined: number;
  minted: number;
  wouldMint: number;
  enriched: number;
  refused: number;
  errors: number;
  refusalReasons: Record<string, number>;
} {
  const refusalReasons: Record<string, number> = {};
  let minted = 0;
  let wouldMint = 0;
  let enriched = 0;
  let refused = 0;
  let errors = 0;
  for (const row of rows) {
    if (row.outcome === 'minted') minted += 1;
    else if (row.outcome === 'would-mint') wouldMint += 1;
    else if (row.outcome === 'enriched') enriched += 1;
    else if (row.outcome === 'error') errors += 1;
    else {
      refused += 1;
      const reason = row.skippedReason || 'unknown';
      refusalReasons[reason] = (refusalReasons[reason] ?? 0) + 1;
    }
  }
  return { examined: rows.length, minted, wouldMint, enriched, refused, errors, refusalReasons };
}
