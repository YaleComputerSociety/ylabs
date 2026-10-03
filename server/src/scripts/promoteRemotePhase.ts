import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { isDirectScriptInvocation } from './directScriptInvocation';
import {
  REMOTE_PHASE_RESULT_MARKER,
  parseRemotePhaseArgs,
  remotePhaseEnvironmentProblems,
  remotePhaseSteps,
  type RemotePhaseStep,
} from './promoteCore';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '..');

export interface RemotePhaseStepResult {
  label: string;
  exitCode: number | null;
  durationMs: number;
}

export type StepRunner = (step: RemotePhaseStep) => number | null;

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
    const startedAt = now();
    const exitCode = runner(step);
    results.push({ label: step.label, exitCode, durationMs: now() - startedAt });
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
