/**
 * Pure argument parsing and reporting for `observations:rematerialize-user-keys`.
 */
export interface RematerializeUserKeysArgs {
  keysFile: string;
  apply: boolean;
  confirm: boolean;
  passes: number;
  output?: string;
}

export const REMATERIALIZE_USER_KEYS_CONFIRM_FLAG = '--confirm-rematerialize-user-keys';

export function parseRematerializeUserKeysArgs(argv: string[]): RematerializeUserKeysArgs {
  const args: RematerializeUserKeysArgs = { keysFile: '', apply: false, confirm: false, passes: 1 };
  for (const arg of argv) {
    if (arg === '--apply') args.apply = true;
    else if (arg === '--dry-run') args.apply = false;
    else if (arg === REMATERIALIZE_USER_KEYS_CONFIRM_FLAG) args.confirm = true;
    else if (arg.startsWith('--keys-file='))
      args.keysFile = arg.slice('--keys-file='.length).trim();
    else if (arg.startsWith('--output=')) args.output = arg.slice('--output='.length).trim();
    else if (arg.startsWith('--passes=')) {
      const passes = Number.parseInt(arg.slice('--passes='.length), 10);
      if (!Number.isSafeInteger(passes) || passes < 1 || passes > 3) {
        throw new Error('--passes must be 1, 2 or 3.');
      }
      args.passes = passes;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.keysFile) throw new Error('--keys-file=<json array of user entityKeys> is required.');
  if (args.apply && !args.confirm) {
    throw new Error(`--apply requires ${REMATERIALIZE_USER_KEYS_CONFIRM_FLAG}.`);
  }
  return args;
}

/** The keys a file names: a JSON array of non-empty strings, de-duplicated in order. */
export function userKeysFromJson(text: string): string[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error('The keys file must hold a JSON array of strings.');
  const keys = parsed.map((value) => (typeof value === 'string' ? value.trim() : ''));
  if (keys.some((key) => !key)) throw new Error('Every key in the keys file must be a string.');
  return [...new Set(keys)];
}

export interface UserKeyPassRow {
  entityKey: string;
  fieldsWritten: number;
  plannedPaths: string[];
  skipped?: string;
  error?: string;
}

export interface UserKeyPassSummary {
  pass: number;
  keys: number;
  keysWriting: number;
  fieldsWritten: number;
  skipped: Record<string, number>;
  errors: number;
}

export function summarizeUserKeyPass(
  pass: number,
  rows: readonly UserKeyPassRow[],
): UserKeyPassSummary {
  const skipped: Record<string, number> = {};
  for (const row of rows) if (row.skipped) skipped[row.skipped] = (skipped[row.skipped] ?? 0) + 1;
  return {
    pass,
    keys: rows.length,
    keysWriting: rows.filter((row) => row.fieldsWritten > 0).length,
    fieldsWritten: rows.reduce((total, row) => total + row.fieldsWritten, 0),
    skipped,
    errors: rows.filter((row) => row.error).length,
  };
}
