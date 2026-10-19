import { spawnSync } from 'child_process';
import { existsSync, readFileSync, rmSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { isDirectScriptInvocation } from './directScriptInvocation';
import {
  REMOTE_PHASE_RESULT_MARKER,
  parseRemotePhaseArgs,
  remotePhaseEnvironmentProblems,
  remotePhaseSteps,
  summarizeSearchReindexResult,
  type RemotePhaseStep,
} from './promoteCore';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '..');

export interface RemotePhaseStepResult {
  label: string;
  exitCode: number | null;
  durationMs: number;
  summary?: Record<string, unknown>;
}

export type StepRunner = (step: RemotePhaseStep) => number | null;

export interface StepResultFiles {
  clear: (file: string) => void;
  read: (file: string) => string | undefined;
}

const stepResultFiles: StepResultFiles = {
  clear: (file) => rmSync(file, { force: true }),
  read: (file) => (existsSync(file) ? readFileSync(file, 'utf8') : undefined),
};

function runStep(step: RemotePhaseStep): number | null {
  const result = spawnSync(step.command, step.args, {
    cwd: step.cwd === 'server' ? SERVER_ROOT : REPO_ROOT,
    env: { ...process.env, ...step.env },
    stdio: 'inherit',
  });
  if (result.error) console.error(`[promote:remote-phase] ${sanitizeLogValue(result.error)}`);
  return result.status;
}

export function runRemotePhase(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  runner: StepRunner = runStep,
  now: () => number = Date.now,
  files: StepResultFiles = stepResultFiles,
): number {
  const args = parseRemotePhaseArgs(argv);
  const problems = remotePhaseEnvironmentProblems(args.environment, env);
  const results: RemotePhaseStepResult[] = [];
  const report = (status: 'succeeded' | 'failed' | 'refused', failedStep?: string) =>
    console.log(
      `${REMOTE_PHASE_RESULT_MARKER} ${JSON.stringify({ environment: args.environment, status, failedStep, problems, steps: results })}`,
    );
  if (problems.length > 0) {
    for (const problem of problems) console.error(`[promote:remote-phase] refused: ${problem}`);
    report('refused');
    return 1;
  }
  for (const step of remotePhaseSteps(args.environment, args)) {
    console.log(`\n[promote:remote-phase] ${step.label}`);
    if (step.resultFile) files.clear(step.resultFile);
    const startedAt = now();
    const exitCode = runner(step);
    const raw = step.resultFile ? files.read(step.resultFile) : undefined;
    const summary = raw === undefined ? undefined : summarizeSearchReindexResult(raw);
    results.push({
      label: step.label,
      exitCode,
      durationMs: now() - startedAt,
      ...(summary ? { summary } : {}),
    });
    if (exitCode !== 0) {
      console.error(`[promote:remote-phase] ${step.label} exited ${exitCode}; stopping`);
      report('failed', step.label);
      return 1;
    }
  }
  report('succeeded');
  return 0;
}

if (isDirectScriptInvocation(import.meta.url, 'promoteRemotePhase')) {
  try {
    process.exitCode = runRemotePhase(process.argv.slice(2));
  } catch (error) {
    console.error(`[promote:remote-phase] failed: ${sanitizeLogValue(error)}`);
    process.exitCode = 1;
  }
}
