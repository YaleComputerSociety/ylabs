import fs from 'fs';
import os from 'os';
import path from 'path';

export type SweepStepStatus = 'pending' | 'running' | 'done' | 'failed';
export type SweepStepKind = 'source' | 'stage' | 'prune';

export interface SweepCheckpointStep {
  id: string;
  kind: SweepStepKind;
  status: SweepStepStatus;
  exitCode?: number;
  startedAt?: string;
  finishedAt?: string;
}

export interface SweepCheckpoint {
  mode: string;
  outputDirectory: string;
  createdAt: string;
  updatedAt: string;
  steps: Record<string, SweepCheckpointStep>;
}

export function sourceStepId(sourceName: string): string {
  return `source:${sourceName}`;
}

export function stageStepId(stageName: string): string {
  return `stage:${stageName}`;
}

export function pruneStepId(label: string): string {
  return `prune:${label}`;
}

export function checkpointPathForMode(mode: string, tmpDir: string = os.tmpdir()): string {
  return path.join(tmpDir, `ylabs-sweep-checkpoint-${mode}.json`);
}

export function createSweepCheckpoint(input: {
  mode: string;
  outputDirectory: string;
  now: Date;
}): SweepCheckpoint {
  const iso = input.now.toISOString();
  return {
    mode: input.mode,
    outputDirectory: input.outputDirectory,
    createdAt: iso,
    updatedAt: iso,
    steps: {},
  };
}

export function readSweepCheckpoint(checkpointPath: string): SweepCheckpoint | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(checkpointPath, 'utf8');
  } catch {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as SweepCheckpoint;
    if (!parsed || typeof parsed.mode !== 'string' || typeof parsed.outputDirectory !== 'string') {
      return undefined;
    }
    if (!parsed.steps || typeof parsed.steps !== 'object') parsed.steps = {};
    return parsed;
  } catch {
    return undefined;
  }
}

export function writeSweepCheckpointAtomic(
  checkpointPath: string,
  checkpoint: SweepCheckpoint,
): void {
  fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
  const tempPath = `${checkpointPath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
  fs.renameSync(tempPath, checkpointPath);
}

export function removeSweepCheckpoint(checkpointPath: string): void {
  fs.rmSync(checkpointPath, { force: true });
}

export function isStepDone(checkpoint: SweepCheckpoint, stepId: string): boolean {
  return checkpoint.steps[stepId]?.status === 'done';
}

export class SweepCheckpointStore {
  private constructor(
    readonly checkpointPath: string,
    readonly checkpoint: SweepCheckpoint,
  ) {}

  static start(input: {
    mode: string;
    checkpointPath: string;
    outputDirectory: string;
    now: Date;
    restart: boolean;
  }): { store: SweepCheckpointStore; resumed: boolean } {
    if (input.restart) removeSweepCheckpoint(input.checkpointPath);
    const existing = input.restart ? undefined : readSweepCheckpoint(input.checkpointPath);
    if (existing && existing.mode === input.mode) {
      return { store: new SweepCheckpointStore(input.checkpointPath, existing), resumed: true };
    }
    const checkpoint = createSweepCheckpoint({
      mode: input.mode,
      outputDirectory: input.outputDirectory,
      now: input.now,
    });
    const store = new SweepCheckpointStore(input.checkpointPath, checkpoint);
    store.persist(input.now);
    return { store, resumed: false };
  }

  get outputDirectory(): string {
    return this.checkpoint.outputDirectory;
  }

  isDone(stepId: string): boolean {
    return isStepDone(this.checkpoint, stepId);
  }

  markRunning(stepId: string, kind: SweepStepKind, now: Date): void {
    this.checkpoint.steps[stepId] = {
      id: stepId,
      kind,
      status: 'running',
      startedAt: now.toISOString(),
    };
    this.persist(now);
  }

  markDone(stepId: string, kind: SweepStepKind, exitCode: number, now: Date): void {
    this.upsert(stepId, kind, 'done', exitCode, now);
  }

  markFailed(stepId: string, kind: SweepStepKind, exitCode: number, now: Date): void {
    this.upsert(stepId, kind, 'failed', exitCode, now);
  }

  private upsert(
    stepId: string,
    kind: SweepStepKind,
    status: SweepStepStatus,
    exitCode: number,
    now: Date,
  ): void {
    const existing = this.checkpoint.steps[stepId];
    this.checkpoint.steps[stepId] = {
      id: stepId,
      kind,
      status,
      exitCode,
      ...(existing?.startedAt ? { startedAt: existing.startedAt } : {}),
      finishedAt: now.toISOString(),
    };
    this.persist(now);
  }

  private persist(now: Date): void {
    this.checkpoint.updatedAt = now.toISOString();
    writeSweepCheckpointAtomic(this.checkpointPath, this.checkpoint);
  }
}
