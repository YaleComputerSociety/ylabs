import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { statedPauseUntil } from '../scrapers/utils/hostPause';
import { normalizeExcludedHost } from '../utils/excludedHosts';
import {
  hostPausedUntil,
  machineHostBudgetDirectory,
  recordHostBackoff,
} from '../scrapers/utils/machineHostBudget';

/**
 * Seeds one host's shared pause from a refusal notice already on disk (#6168).
 *
 * The date comes only from `statedPauseUntil`, the parser the live 403 path uses, so an operator
 * cannot type a date in; with no readable date the seed records nothing. It records through
 * `recordHostBackoff`, the call the live path makes, and writes nothing but the machine budget's
 * per-host state file: the host, the pause and `stated-until` as the evidence, never any part of
 * the body, which carries this machine's own address.
 */
export const HOST_PAUSE_SEED_STATUS = 403;

export interface SeedHostPauseOptions {
  host: string;
  bodyFile: string;
  apply: boolean;
}

export function parseArgs(argv: string[]): SeedHostPauseOptions {
  const values = new Map<string, string>();
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    const inline = /^--(host|body-file)=(.*)$/.exec(arg);
    if (inline) {
      values.set(inline[1], inline[2]);
      continue;
    }
    if (arg === '--host' || arg === '--body-file') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${arg} needs a value`);
      }
      values.set(arg.slice(2), value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  const host = normalizeExcludedHost(values.get('host') ?? '');
  const bodyFile = values.get('body-file');
  if (!host) throw new Error('--host <host> is required');
  if (!bodyFile) throw new Error('--body-file <path> is required');
  return { host, bodyFile: path.resolve(bodyFile), apply };
}

export interface SeedHostPauseResult {
  host: string;
  statedUntil?: Date;
  pausedUntil?: Date;
  applied: boolean;
}

export async function seedHostPauseFromNotice(
  options: SeedHostPauseOptions,
): Promise<SeedHostPauseResult> {
  const statedUntil = statedPauseUntil(fs.readFileSync(options.bodyFile, 'utf8'));
  if (!statedUntil) return { host: options.host, applied: false };
  if (!options.apply) return { host: options.host, statedUntil, applied: false };
  const pausedUntil = await recordHostBackoff(options.host, {
    status: HOST_PAUSE_SEED_STATUS,
    statedUntil,
  });
  return { host: options.host, statedUntil, pausedUntil, applied: true };
}

export function describeSeedResult(result: SeedHostPauseResult): string {
  if (!result.statedUntil) {
    return `${result.host}: the notice states no date still ahead, so nothing was recorded`;
  }
  if (!result.applied) {
    return `${result.host}: would pause until ${result.statedUntil.toISOString()} (dry run; pass --apply to record it)`;
  }
  return `${result.host}: paused until ${(result.pausedUntil ?? result.statedUntil).toISOString()}`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const result = await seedHostPauseFromNotice(options);
  console.log(describeSeedResult(result));
  if (result.applied) {
    console.log(`state directory: ${machineHostBudgetDirectory()}`);
    console.log(`read back: ${hostPausedUntil(result.host)?.toISOString() ?? 'not paused'}`);
  }
  if (!result.statedUntil) process.exitCode = 1;
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  // The notice body names this machine's own address, so a failure prints the host and nothing else.
  void main().catch((error: unknown) => {
    console.error(`could not seed the host pause: ${(error as Error)?.message ?? 'unknown error'}`);
    process.exitCode = 1;
  });
}
