import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SweepCheckpointStore,
  checkpointPathForMode,
  readSweepCheckpoint,
  sourceStepId,
  stageStepId,
  sweepCheckpointFlagSignature,
  writeSweepCheckpointAtomic,
} from '../scraperSweepCheckpoint';

describe('scraper sweep checkpoint', () => {
  let dir: string;
  const now = () => new Date('2026-08-27T00:00:00.000Z');

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-checkpoint-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('keys the checkpoint path per mode', () => {
    expect(checkpointPathForMode('development-full', dir)).toBe(
      path.join(dir, 'ylabs-sweep-checkpoint-development-full.json'),
    );
    expect(checkpointPathForMode('fellowship-development-full', dir)).not.toBe(
      checkpointPathForMode('development-full', dir),
    );
  });

  it('persists every state change atomically and reloads it', () => {
    const checkpointPath = path.join(dir, 'checkpoint.json');
    const { store, resumed } = SweepCheckpointStore.start({
      mode: 'development-full',
      checkpointPath,
      outputDirectory: path.join(dir, 'out'),
      now: now(),
      restart: false,
    });
    expect(resumed).toBe(false);
    store.markRunning(sourceStepId('yale-directory'), 'source', now());
    store.markDone(sourceStepId('yale-directory'), 'source', 0, now());
    const reloaded = readSweepCheckpoint(checkpointPath);
    expect(reloaded?.outputDirectory).toBe(path.join(dir, 'out'));
    expect(reloaded?.steps[sourceStepId('yale-directory')]).toMatchObject({
      status: 'done',
      exitCode: 0,
    });
  });

  it('resumes an existing same-mode checkpoint so done steps are skipped and others re-run', () => {
    const checkpointPath = path.join(dir, 'checkpoint.json');
    const first = SweepCheckpointStore.start({
      mode: 'development-full',
      checkpointPath,
      outputDirectory: path.join(dir, 'out'),
      now: now(),
      restart: false,
    }).store;
    first.markDone(sourceStepId('yale-directory'), 'source', 0, now());
    first.markFailed(stageStepId('search-rebuild'), 'stage', 1, now());

    const { store: resumedStore, resumed } = SweepCheckpointStore.start({
      mode: 'development-full',
      checkpointPath,
      outputDirectory: path.join(dir, 'ignored-on-resume'),
      now: now(),
      restart: false,
    });
    expect(resumed).toBe(true);
    expect(resumedStore.outputDirectory).toBe(path.join(dir, 'out'));
    expect(resumedStore.isDone(sourceStepId('yale-directory'))).toBe(true);
    expect(resumedStore.isDone(stageStepId('search-rebuild'))).toBe(false);
  });

  it('does not resume a checkpoint recorded for a different mode', () => {
    const checkpointPath = path.join(dir, 'checkpoint.json');
    writeSweepCheckpointAtomic(checkpointPath, {
      mode: 'beta-fetch',
      flags: '',
      outputDirectory: path.join(dir, 'beta-out'),
      ownerPid: process.pid,
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
      steps: {
        [sourceStepId('yale-directory')]: {
          id: sourceStepId('yale-directory'),
          kind: 'source',
          status: 'done',
        },
      },
    });
    const { store, resumed } = SweepCheckpointStore.start({
      mode: 'development-full',
      checkpointPath,
      outputDirectory: path.join(dir, 'dev-out'),
      now: now(),
      restart: false,
    });
    expect(resumed).toBe(false);
    expect(store.isDone(sourceStepId('yale-directory'))).toBe(false);
  });

  it('wipes the checkpoint under --restart and starts fresh', () => {
    const checkpointPath = path.join(dir, 'checkpoint.json');
    const first = SweepCheckpointStore.start({
      mode: 'development-full',
      checkpointPath,
      outputDirectory: path.join(dir, 'out'),
      now: now(),
      restart: false,
    }).store;
    first.markDone(sourceStepId('yale-directory'), 'source', 0, now());

    const { store, resumed } = SweepCheckpointStore.start({
      mode: 'development-full',
      checkpointPath,
      outputDirectory: path.join(dir, 'out2'),
      now: now(),
      restart: true,
    });
    expect(resumed).toBe(false);
    expect(store.outputDirectory).toBe(path.join(dir, 'out2'));
    expect(store.isDone(sourceStepId('yale-directory'))).toBe(false);
  });

  it('treats a corrupt checkpoint file as absent', () => {
    const checkpointPath = path.join(dir, 'checkpoint.json');
    fs.writeFileSync(checkpointPath, 'not json');
    expect(readSweepCheckpoint(checkpointPath)).toBeUndefined();
  });

  it('keys the checkpoint path per worktree so parallel worktrees never share one', () => {
    expect(checkpointPathForMode('development-full', dir, '/repos/worktree-a')).not.toBe(
      checkpointPathForMode('development-full', dir, '/repos/worktree-b'),
    );
    expect(checkpointPathForMode('development-full', dir, '/repos/worktree-a')).toBe(
      checkpointPathForMode('development-full', dir, '/repos/worktree-a'),
    );
  });

  it('does not resume a checkpoint recorded under a different flag set', () => {
    const checkpointPath = path.join(dir, 'checkpoint.json');
    const first = SweepCheckpointStore.start({
      mode: 'development-full',
      flags: sweepCheckpointFlagSignature({ forceLlm: true, pruneBetweenPhases: true }),
      checkpointPath,
      outputDirectory: path.join(dir, 'out'),
      now: now(),
      restart: false,
    }).store;
    first.markDone(sourceStepId('yale-directory'), 'source', 0, now());

    const plain = SweepCheckpointStore.start({
      mode: 'development-full',
      flags: sweepCheckpointFlagSignature({}),
      checkpointPath,
      outputDirectory: path.join(dir, 'out2'),
      now: now(),
      restart: false,
    });
    expect(plain.resumed).toBe(false);
    expect(plain.store.isDone(sourceStepId('yale-directory'))).toBe(false);

    const sameFlags = SweepCheckpointStore.start({
      mode: 'development-full',
      flags: sweepCheckpointFlagSignature({ pruneBetweenPhases: true, forceLlm: true }),
      checkpointPath,
      outputDirectory: path.join(dir, 'out3'),
      now: now(),
      restart: false,
    });
    expect(sameFlags.resumed).toBe(false);
  });

  it('refuses to resume a checkpoint whose owner process is still running a step', () => {
    const checkpointPath = path.join(dir, 'checkpoint.json');
    writeSweepCheckpointAtomic(checkpointPath, {
      mode: 'development-full',
      flags: '',
      outputDirectory: path.join(dir, 'out'),
      ownerPid: 1,
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
      steps: {
        [sourceStepId('yale-directory')]: {
          id: sourceStepId('yale-directory'),
          kind: 'source',
          status: 'running',
        },
      },
    });
    expect(() =>
      SweepCheckpointStore.start({
        mode: 'development-full',
        checkpointPath,
        outputDirectory: path.join(dir, 'out'),
        now: now(),
        restart: false,
      }),
    ).toThrow(/still running/);
    expect(
      SweepCheckpointStore.start({
        mode: 'development-full',
        checkpointPath,
        outputDirectory: path.join(dir, 'fresh'),
        now: now(),
        restart: true,
      }).resumed,
    ).toBe(false);
  });

  it('clears only the aggregate stage steps so the post-run chain re-runs', () => {
    const checkpointPath = path.join(dir, 'checkpoint.json');
    const { store } = SweepCheckpointStore.start({
      mode: 'development-full',
      checkpointPath,
      outputDirectory: path.join(dir, 'out'),
      now: now(),
      restart: false,
    });
    store.markDone(sourceStepId('yale-directory'), 'source', 0, now());
    store.markDone(stageStepId('visibility-gate'), 'stage', 0, now());
    store.markDone(stageStepId('search-rebuild'), 'stage', 0, now());

    expect(store.clearStageSteps(now()).sort()).toEqual([
      stageStepId('search-rebuild'),
      stageStepId('visibility-gate'),
    ]);
    expect(store.isDone(stageStepId('visibility-gate'))).toBe(false);
    expect(store.isDone(sourceStepId('yale-directory'))).toBe(true);
    expect(
      readSweepCheckpoint(checkpointPath)?.steps[stageStepId('search-rebuild')],
    ).toBeUndefined();
    expect(store.clearStageSteps(now())).toEqual([]);
  });
});
