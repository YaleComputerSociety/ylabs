import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ORPHANED_MONGO_MEMORY_MIN_AGE_MS,
  createRunTempRoot,
  mongodPathsIn,
  reapStaleTempResidue,
  runTempRootOwnerPid,
  type TempResidueProbes,
} from '../runTempRoot';

const DEAD_PID = 4_000_001;
const LIVE_PID = 4_000_002;

describe('run temp root reaper', () => {
  let parent: string;
  let livePaths: string[] | undefined;
  const now = Date.now();

  const probes = (): TempResidueProbes => ({
    isProcessAlive: (pid) => pid === LIVE_PID,
    liveMongodPaths: () => livePaths,
    now: () => now,
  });

  const makeDirectory = (name: string, ageMs = 0): string => {
    const directory = path.join(parent, name);
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'WiredTiger'), 'synthetic');
    const modifiedAt = new Date(now - ageMs);
    fs.utimesSync(directory, modifiedAt, modifiedAt);
    return directory;
  };

  beforeEach(() => {
    parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-reaper-fixture-'));
    livePaths = [];
  });

  afterEach(() => {
    fs.rmSync(parent, { recursive: true, force: true });
  });

  it('removes a run root whose owning process is gone', () => {
    const stale = makeDirectory(`ylabs-vitest-${DEAD_PID}-abc123`);

    expect(reapStaleTempResidue(parent, probes())).toEqual([stale]);
    expect(fs.existsSync(stale)).toBe(false);
  });

  it('leaves a run root whose owner is still running', () => {
    const live = makeDirectory(`ylabs-vitest-${LIVE_PID}-abc123`);

    expect(reapStaleTempResidue(parent, probes())).toEqual([]);
    expect(fs.existsSync(live)).toBe(true);
  });

  it('leaves a dead run root that a live mongod still uses', () => {
    const root = makeDirectory(`ylabs-vitest-${DEAD_PID}-abc123`);
    livePaths = [path.join(root, 'mongo-mem-xyz')];

    expect(reapStaleTempResidue(parent, probes())).toEqual([]);
    expect(fs.existsSync(root)).toBe(true);
  });

  it('removes an old in-memory Mongo directory that no live mongod references', () => {
    const orphan = makeDirectory('mongo-mem-orphan', ORPHANED_MONGO_MEMORY_MIN_AGE_MS + 1000);

    expect(reapStaleTempResidue(parent, probes())).toEqual([orphan]);
  });

  it('leaves an in-memory Mongo directory a live mongod is using, however old', () => {
    const used = makeDirectory('mongo-mem-used', ORPHANED_MONGO_MEMORY_MIN_AGE_MS * 10);
    livePaths = [used];

    expect(reapStaleTempResidue(parent, probes())).toEqual([]);
    expect(fs.existsSync(used)).toBe(true);
  });

  it('leaves a young in-memory Mongo directory, which may be a launch in progress', () => {
    makeDirectory('mongo-mem-young', 1000);

    expect(reapStaleTempResidue(parent, probes())).toEqual([]);
  });

  it('removes no in-memory Mongo directory when the process list cannot be read', () => {
    makeDirectory('mongo-mem-unknown', ORPHANED_MONGO_MEMORY_MIN_AGE_MS * 10);
    livePaths = undefined;

    expect(reapStaleTempResidue(parent, probes())).toEqual([]);
  });

  it('ignores directories it does not own', () => {
    makeDirectory('ylabs-operator-board-abc', ORPHANED_MONGO_MEMORY_MIN_AGE_MS * 10);
    makeDirectory('ylabs-vitest-not-a-pid', ORPHANED_MONGO_MEMORY_MIN_AGE_MS * 10);

    expect(reapStaleTempResidue(parent, probes())).toEqual([]);
  });

  it('names a new run root after the process that owns it', () => {
    const root = createRunTempRoot(parent, LIVE_PID);

    expect(runTempRootOwnerPid(path.basename(root))).toBe(LIVE_PID);
  });
});

describe('live mongod paths', () => {
  it('reads every absolute path argument of a mongod and nothing from other processes', () => {
    const listing = [
      '/cache/mongodb-binaries/mongod-arm64-darwin-8.2.6 --port 61476 --dbpath /tmp/mongo-mem-a --replSet testset',
      '/usr/bin/node /repo/node_modules/mongodb-memory-server-core/scripts/mongo_killer.js 1 2 /tmp/mongo-mem-b',
      'mongod --dbpath /tmp/mongo-mem-c --keyFile /tmp/mongo-mem-keyfile-d/keyfile',
    ].join('\n');

    expect(mongodPathsIn(listing)).toEqual([
      '/tmp/mongo-mem-a',
      '/tmp/mongo-mem-c',
      '/tmp/mongo-mem-keyfile-d/keyfile',
    ]);
  });
});
