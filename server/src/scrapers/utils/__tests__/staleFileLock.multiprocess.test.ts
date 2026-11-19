import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hermeticChildEnvironment } from '../../../test/hermeticEnvironment';

const RACE_CLIENT = path.resolve(__dirname, 'fixtures/staleLockRaceClient.ts');
const SERVER_ROOT = path.resolve(__dirname, '../../../..');
const DEAD_PID = 4_000_001;
const ROUNDS = 25;

let directory: string;

beforeEach(() => {
  directory = fs.mkdtempSync('/tmp/ylsfl-');
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('breakFileLockIfUnchanged across processes (#6227)', () => {
  it('never lets two of three processes hold a broken dead holder lock at once', async () => {
    const children = Array.from({ length: 3 }, () =>
      spawn(process.execPath, ['--import', 'tsx', RACE_CLIENT], {
        cwd: SERVER_ROOT,
        env: hermeticChildEnvironment({
          FIXTURE_DIR: directory,
          FIXTURE_ROUNDS: String(ROUNDS),
        }),
        stdio: 'ignore',
      }),
    );
    const exited = children.map(
      (child) => new Promise<number | null>((resolve) => child.on('exit', resolve)),
    );
    const lockPath = path.join(directory, 'race.lock');
    const holdersPerRound: number[] = [];
    try {
      await pause(1_500);
      for (let round = 0; round < ROUNDS; round += 1) {
        fs.writeFileSync(lockPath, JSON.stringify({ pid: DEAD_PID, token: `dead-${round}` }));
        fs.writeFileSync(path.join(directory, `round-${round}.go`), '');
        await pause(400);
        const holders = path.join(directory, `round-${round}.holders`);
        holdersPerRound.push(
          fs.existsSync(holders)
            ? fs.readFileSync(holders, 'utf8').split('\n').filter(Boolean).length
            : 0,
        );
        fs.writeFileSync(path.join(directory, `round-${round}.done`), '');
        await pause(50);
        fs.rmSync(lockPath, { force: true });
      }
      expect(await Promise.all(exited)).toEqual([0, 0, 0]);
    } finally {
      for (const child of children) child.kill('SIGKILL');
    }
    expect(holdersPerRound.every((holders) => holders <= 1)).toBe(true);
    expect(holdersPerRound.filter((holders) => holders === 1).length).toBeGreaterThan(ROUNDS / 2);
  }, 60_000);
});
