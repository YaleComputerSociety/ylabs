import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { breakFileLockIfUnchanged, readFileLock } from '../../staleFileLock';

const directory = String(process.env.FIXTURE_DIR);
const rounds = Number(process.env.FIXTURE_ROUNDS);
const lockPath = path.join(directory, 'race.lock');
const STALE_MS = 2_000;

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForFile(file: string): Promise<void> {
  while (!fs.existsSync(file)) await pause(1);
}

function tryLock(token: string): boolean {
  try {
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, token, at: Date.now() }), {
      flag: 'wx',
    });
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await waitForFile(path.join(directory, `round-${round}.go`));
    const token = `${process.pid}-${randomUUID()}`;
    const deadline = Date.now() + 300;
    let held = false;
    while (!held && Date.now() < deadline) {
      if (tryLock(token)) {
        held = true;
        break;
      }
      const lock = readFileLock(lockPath, Date.now);
      if (
        lock &&
        (lock.ageMs > STALE_MS ||
          (lock.pid !== undefined && lock.pid !== process.pid && !isAlive(lock.pid)))
      ) {
        breakFileLockIfUnchanged(lockPath, lock.raw, {
          now: Date.now,
          pid: process.pid,
          guardStaleMs: STALE_MS,
        });
      }
    }
    if (held) fs.appendFileSync(path.join(directory, `round-${round}.holders`), `${process.pid}\n`);
    await waitForFile(path.join(directory, `round-${round}.done`));
    if (held) {
      const current = readFileLock(lockPath, Date.now);
      if (current && current.raw.includes(token)) fs.rmSync(lockPath, { force: true });
    }
  }
  process.exit(0);
}

void main();
