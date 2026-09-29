import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { SweepCodeDriftRefusal } from './sweepCodeIdentityCore';

export type SweepStepStatus = 'pending' | 'running' | 'done' | 'failed';
export type SweepStepKind = 'source' | 'stage' | 'prune';

export interface SweepCheckpointStep {
  id: string;
  kind: SweepStepKind;
  status: SweepStepStatus;
  exitCode?: number;
  artifactPath?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface SweepCheckpoint {
  mode: string;
  flags: string;
  codeSha: string | null;
  codeDrift: SweepCodeDriftRefusal[];
  outputDirectory: string;
  ownerPid: number;
  createdAt: string;
  updatedAt: string;
  steps: Record<string, SweepCheckpointStep>;
}

export interface SweepCheckpointFlagInput {
  forceLlm?: boolean;
  pruneBetweenPhases?: boolean;
}

export function sweepCheckpointFlagSignature(input: SweepCheckpointFlagInput): string {
  const flags: string[] = [];
  if (input.forceLlm) flags.push('force-llm');
  if (input.pruneBetweenPhases) flags.push('prune-between-phases');
  return flags.join(',');
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

export function checkpointScopeFingerprint(scope: string): string {
  return createHash('sha256').update(path.resolve(scope)).digest('hex').slice(0, 12);
}

export function checkpointPathForMode(
  mode: string,
  tmpDir: string = os.tmpdir(),
  scope?: string,
): string {
  const scopeSuffix = scope ? `-${checkpointScopeFingerprint(scope)}` : '';
  return path.join(tmpDir, `ylabs-sweep-checkpoint-${mode}${scopeSuffix}.json`);
}

export function createSweepCheckpoint(input: {
  mode: string;
  flags?: string;
  codeSha?: string | null;
  outputDirectory: string;
  now: Date;
}): SweepCheckpoint {
  const iso = input.now.toISOString();
  return {
    mode: input.mode,
    flags: input.flags ?? '',
    codeSha: input.codeSha ?? null,
    codeDrift: [],
    outputDirectory: input.outputDirectory,
    ownerPid: process.pid,
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
    if (typeof parsed.flags !== 'string') parsed.flags = '';
    if (typeof parsed.ownerPid !== 'number') parsed.ownerPid = 0;
    if (typeof parsed.codeSha !== 'string') parsed.codeSha = null;
    if (!Array.isArray(parsed.codeDrift)) parsed.codeDrift = [];
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

export function isSweepOwnerProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function assertCheckpointNotOwnedByLiveSweep(
  checkpoint: SweepCheckpoint,
  checkpointPath: string,
): void {
  const hasRunningStep = Object.values(checkpoint.steps).some((step) => step.status === 'running');
  if (!hasRunningStep || !isSweepOwnerProcessAlive(checkpoint.ownerPid)) return;
  throw new Error(
    `Another ${checkpoint.mode} sweep (pid ${checkpoint.ownerPid}) is still running against ${checkpointPath}. Wait for it to finish, or pass --restart to abandon its checkpoint.`,
  );
}

export class SweepCheckpointStore {
  private constructor(
    readonly checkpointPath: string,
    readonly checkpoint: SweepCheckpoint,
  ) {}

  static start(input: {
    mode: string;
    flags?: string;
    codeSha?: string | null;
    checkpointPath: string;
    outputDirectory: string;
    now: Date;
    restart: boolean;
  }): { store: SweepCheckpointStore; resumed: boolean } {
    const flags = input.flags ?? '';
    if (input.restart) removeSweepCheckpoint(input.checkpointPath);
    const existing = input.restart ? undefined : readSweepCheckpoint(input.checkpointPath);
    const codeMoved = Boolean(
      existing?.codeSha && input.codeSha && existing.codeSha !== input.codeSha,
    );
    if (existing && existing.mode === input.mode && existing.flags === flags && !codeMoved) {
      assertCheckpointNotOwnedByLiveSweep(existing, input.checkpointPath);
      return { store: new SweepCheckpointStore(input.checkpointPath, existing), resumed: true };
    }
    if (existing && existing.mode === input.mode && existing.flags !== flags) {
      console.warn(
        `[checkpoint] not resuming ${input.mode}: checkpoint was recorded for flags "${existing.flags || '(none)'}" but this invocation uses "${flags || '(none)'}"`,
      );
    } else if (existing && existing.mode === input.mode && codeMoved) {
      console.warn(
        `[checkpoint] not resuming ${input.mode}: checkpoint was recorded at ${existing.codeSha} but the checkout is at ${input.codeSha}, so this is a new sweep; to resume the earlier one, reset the checkout to ${existing.codeSha} and run again`,
      );
    }
    const checkpoint = createSweepCheckpoint({
      mode: input.mode,
      flags,
      codeSha: input.codeSha,
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

  get codeSha(): string | null {
    return this.checkpoint.codeSha;
  }

  get codeDrift(): SweepCodeDriftRefusal[] {
    return this.checkpoint.codeDrift;
  }

  recordCodeDrift(refusal: SweepCodeDriftRefusal, now: Date): void {
    this.checkpoint.codeDrift.push(refusal);
    this.persist(now);
  }

  isDone(stepId: string): boolean {
    return isStepDone(this.checkpoint, stepId);
  }

  clearStageSteps(now: Date): string[] {
    const cleared = Object.values(this.checkpoint.steps)
      .filter((step) => step.kind === 'stage')
      .map((step) => step.id);
    if (cleared.length === 0) return [];
    for (const stepId of cleared) delete this.checkpoint.steps[stepId];
    this.persist(now);
    return cleared;
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

  markDone(
    stepId: string,
    kind: SweepStepKind,
    exitCode: number,
    now: Date,
    artifactPath?: string,
  ): void {
    this.upsert(stepId, kind, 'done', exitCode, now, artifactPath);
  }

  recordedArtifactPath(stepId: string): string | undefined {
    const artifactPath = this.checkpoint.steps[stepId]?.artifactPath;
    return typeof artifactPath === 'string' && artifactPath ? artifactPath : undefined;
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
    artifactPath?: string,
  ): void {
    const existing = this.checkpoint.steps[stepId];
    this.checkpoint.steps[stepId] = {
      id: stepId,
      kind,
      status,
      exitCode,
      ...(artifactPath ? { artifactPath } : {}),
      ...(existing?.startedAt ? { startedAt: existing.startedAt } : {}),
      finishedAt: now.toISOString(),
    };
    this.persist(now);
  }

  private persist(now: Date): void {
    this.checkpoint.ownerPid = process.pid;
    this.checkpoint.updatedAt = now.toISOString();
    writeSweepCheckpointAtomic(this.checkpointPath, this.checkpoint);
  }
}
