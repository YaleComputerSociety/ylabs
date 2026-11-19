import { spawn } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { hermeticChildEnvironment } from '../../test/hermeticEnvironment';
import { RUN_SCRIPT_MAIN_RECEIVED } from './fixtures/recordingConnections';

const SERVER_ROOT = path.resolve(__dirname, '../../..');
const RECORDING_HOOKS = path.join(__dirname, 'fixtures', 'recordRunScriptMainHooks.mjs');
const CHAINING_ENTRY_POINT = path.join(__dirname, 'fixtures', 'entryPointChainingItsOwnExit.ts');
const CHILD_RUN_CEILING_MS = 45_000;

/**
 * Long-running operator entry points, and why each one must exit through runScriptMain (#5945).
 * A script that finished its work but kept the event loop open had to be stopped by PID, and an
 * operator or cron cannot tell that from a hang without the watchdog's exit code 3.
 */
const LONG_SCRIPT_ENTRY_POINTS: Record<string, string> = {
  scrape:
    'scrape run and scrape materialize drive every lane and the materializer over the whole corpus',
  'observations:rematerialize-user-keys':
    'rematerializes every person key a lane re-keyed, a multi-hour pass over user observations',
  'research-entity:rematerialize':
    'rematerializes research rows in bulk, the longest materializer pass an operator starts by hand',
  'observations:retire-rekeyed-person-keys':
    'projects thousands of person keys through the engine twice each; the run that never exited was this path',
  'observations:retire-orphaned-lane-configs':
    'projects every row an orphaned lane config backs through the engine before retiring evidence',
  'research-entity:coverage-synthesis':
    'synthesizes coverage text across the corpus, row by row, for hours',
  'research-entity:coverage-audit': 'scans every research row to audit coverage',
  'research-entity:projection-drift-census':
    'reprojects stored rows through the engine to census drift against what is stored',
};

interface RecordedRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

const recordingEnvironment = (): NodeJS.ProcessEnv => {
  const env = hermeticChildEnvironment();
  env.NODE_OPTIONS = [env.NODE_OPTIONS, `--import ${RECORDING_HOOKS}`].filter(Boolean).join(' ');
  return env;
};

const runRecorded = (command: string, args: string[]) =>
  new Promise<RecordedRun>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: SERVER_ROOT,
      env: recordingEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    const ceiling = setTimeout(() => child.kill('SIGKILL'), CHILD_RUN_CEILING_MS);
    child.on('error', reject);
    child.on('close', (status) => {
      clearTimeout(ceiling);
      resolve({ status, stdout, stderr });
    });
  });

const handsMainToRunScriptMain = (run: RecordedRun): boolean =>
  run.status === 0 && run.stdout.includes(RUN_SCRIPT_MAIN_RECEIVED);

describe('long script entry points exit through runScriptMain (#5945)', () => {
  it('gives a reason for every entry point it lists', () => {
    expect(
      Object.entries(LONG_SCRIPT_ENTRY_POINTS).filter(([, reason]) => reason.trim().length === 0),
    ).toEqual([]);
  });

  it(
    'hands main to runScriptMain when each listed package script runs',
    async () => {
      const names = Object.keys(LONG_SCRIPT_ENTRY_POINTS);
      const runs = await Promise.all(names.map((name) => runRecorded('yarn', ['run', name])));
      const offenders = names
        .map((name, index) => ({ name, run: runs[index] }))
        .filter(({ run }) => !handsMainToRunScriptMain(run))
        .map(({ name, run }) => ({ name, status: run.status, stderr: run.stderr.slice(-500) }));
      expect(offenders).toEqual([]);
    },
    CHILD_RUN_CEILING_MS + 15_000,
  );

  it(
    'does not record an entry point that imports runScriptMain but chains its own exit onto main',
    async () => {
      const run = await runRecorded(process.execPath, ['--import', 'tsx', CHAINING_ENTRY_POINT]);

      expect(run.stdout).toContain('main ran without runScriptMain');
      expect(handsMainToRunScriptMain(run)).toBe(false);
    },
    CHILD_RUN_CEILING_MS + 15_000,
  );
});
