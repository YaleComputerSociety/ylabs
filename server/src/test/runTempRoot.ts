import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const RUN_TEMP_ROOT_PREFIX = 'ylabs-vitest-';
export const MONGO_MEMORY_DIRECTORY_PREFIX = 'mongo-mem-';
export const ORPHANED_MONGO_MEMORY_MIN_AGE_MS = 60 * 60 * 1000;

export interface TempResidueProbes {
  isProcessAlive: (pid: number) => boolean;
  liveMongodPaths: () => string[] | undefined;
  now: () => number;
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const isMongodCommand = (command: string): boolean => /^mongod(?!b)/.test(path.basename(command));

export function mongodPathsIn(processListing: string): string[] {
  return processListing
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter(([command]) => command !== undefined && isMongodCommand(command))
    .flatMap((tokens) => tokens.slice(1).filter((token) => path.isAbsolute(token)));
}

export function liveMongodPaths(): string[] | undefined {
  try {
    return mongodPathsIn(
      execFileSync('ps', ['-Ao', 'args='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }),
    );
  } catch {
    return undefined;
  }
}

export const defaultTempResidueProbes: TempResidueProbes = {
  isProcessAlive,
  liveMongodPaths,
  now: Date.now,
};

export function runTempRootOwnerPid(name: string): number | undefined {
  const match = new RegExp(`^${RUN_TEMP_ROOT_PREFIX}(\\d+)-`).exec(name);
  return match ? Number(match[1]) : undefined;
}

export function createRunTempRoot(parent: string, pid: number = process.pid): string {
  return fs.mkdtempSync(path.join(parent, `${RUN_TEMP_ROOT_PREFIX}${pid}-`));
}

export function removeTempDirectory(directory: string): boolean {
  try {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
    return true;
  } catch {
    return false;
  }
}

const listDirectories = (parent: string): string[] => {
  try {
    return fs
      .readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
};

const isReferenced = (directory: string, livePaths: readonly string[]): boolean =>
  livePaths.some((live) => live === directory || live.startsWith(`${directory}${path.sep}`));

const modifiedAtMs = (directory: string): number | undefined => {
  try {
    return fs.statSync(directory).mtimeMs;
  } catch {
    return undefined;
  }
};

const isStaleRunTempRoot = (
  name: string,
  directory: string,
  livePaths: readonly string[],
  probes: TempResidueProbes,
): boolean => {
  const owner = runTempRootOwnerPid(name);
  if (owner === undefined || probes.isProcessAlive(owner)) return false;
  return !isReferenced(directory, livePaths);
};

const isOrphanedMongoMemoryDirectory = (
  directory: string,
  livePaths: readonly string[] | undefined,
  probes: TempResidueProbes,
): boolean => {
  if (livePaths === undefined || isReferenced(directory, livePaths)) return false;
  const modifiedAt = modifiedAtMs(directory);
  return modifiedAt !== undefined && probes.now() - modifiedAt >= ORPHANED_MONGO_MEMORY_MIN_AGE_MS;
};

export function reapStaleTempResidue(
  parent: string,
  probes: TempResidueProbes = defaultTempResidueProbes,
): string[] {
  const names = listDirectories(parent).filter(
    (name) =>
      name.startsWith(RUN_TEMP_ROOT_PREFIX) || name.startsWith(MONGO_MEMORY_DIRECTORY_PREFIX),
  );
  if (names.length === 0) return [];
  const livePaths = probes.liveMongodPaths();
  return names
    .map((name) => ({ name, directory: path.join(parent, name) }))
    .filter(({ name, directory }) =>
      name.startsWith(RUN_TEMP_ROOT_PREFIX)
        ? isStaleRunTempRoot(name, directory, livePaths ?? [], probes)
        : isOrphanedMongoMemoryDirectory(directory, livePaths, probes),
    )
    .map(({ directory }) => directory)
    .filter(removeTempDirectory);
}
