import fs from 'fs';
import path from 'path';
import { sanitizeLogValue } from '../utils/logSanitizer';

export const DEFAULT_ERROR_LOG_TAIL_LINES = 40;

export function tailLines(content: string, count: number): string[] {
  const lines = content.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return count > 0 ? lines.slice(-count) : [];
}

export function readLogTail(logPath: string | undefined, count = DEFAULT_ERROR_LOG_TAIL_LINES): string[] {
  if (!logPath) return [];
  try {
    return tailLines(fs.readFileSync(logPath, 'utf8'), count);
  } catch {
    return [];
  }
}

export function formatRunnerLogLine(input: {
  at: string;
  event: 'start' | 'done' | 'failed';
  stepId: string;
  detail?: string;
}): string {
  const suffix = input.detail ? ` ${sanitizeLogValue(input.detail)}` : '';
  return `${input.at} [${input.event}] ${input.stepId}${suffix}`;
}

export function formatErrorLogEntry(input: {
  at: string;
  stepId: string;
  exitCode: number;
  tail: string[];
}): string {
  const header = `${input.at} [failed] ${input.stepId} exitCode=${input.exitCode}`;
  const body =
    input.tail.length > 0
      ? input.tail.map((line) => `  | ${line}`).join('\n')
      : '  | (no captured output)';
  return `${header}\n${body}\n`;
}

export class SweepRunLogger {
  private readonly runnerLogPath: string;
  private readonly errorsLogPath: string;

  constructor(
    private readonly outputDirectory: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.runnerLogPath = path.join(outputDirectory, 'runner.log');
    this.errorsLogPath = path.join(outputDirectory, 'errors.log');
  }

  logStart(stepId: string, detail?: string): void {
    this.appendRunner({ event: 'start', stepId, ...(detail ? { detail } : {}) });
  }

  logDone(stepId: string, exitCode: number): void {
    this.appendRunner({ event: 'done', stepId, detail: `exitCode=${exitCode}` });
  }

  logFailed(stepId: string, exitCode: number, logPath?: string): void {
    const at = this.now().toISOString();
    fs.appendFileSync(
      this.runnerLogPath,
      `${formatRunnerLogLine({ at, event: 'failed', stepId, detail: `exitCode=${exitCode}` })}\n`,
    );
    fs.appendFileSync(
      this.errorsLogPath,
      formatErrorLogEntry({ at, stepId, exitCode, tail: readLogTail(logPath) }),
    );
  }

  private appendRunner(input: { event: 'start' | 'done' | 'failed'; stepId: string; detail?: string }): void {
    fs.appendFileSync(
      this.runnerLogPath,
      `${formatRunnerLogLine({ at: this.now().toISOString(), ...input })}\n`,
    );
  }
}
