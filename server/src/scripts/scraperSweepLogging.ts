import fs from 'fs';
import path from 'path';
import { sanitizeLogValue } from '../utils/logSanitizer';

export const DEFAULT_ERROR_LOG_TAIL_LINES = 40;
export const DEFAULT_LOG_TAIL_BYTES = 64 * 1024;

export function tailLines(content: string, count: number): string[] {
  const lines = content.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return count > 0 ? lines.slice(-count) : [];
}

export function readLogTail(
  logPath: string | undefined,
  count = DEFAULT_ERROR_LOG_TAIL_LINES,
  maxBytes = DEFAULT_LOG_TAIL_BYTES,
): string[] {
  if (!logPath || count <= 0) return [];
  let fd: number | undefined;
  try {
    fd = fs.openSync(logPath, 'r');
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, Math.max(0, maxBytes));
    if (length === 0) return [];
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    const lines = tailLines(buffer.toString('utf8'), count + 1);
    const whole = size <= length ? lines : lines.slice(1);
    return whole.slice(-count);
  } catch {
    return [];
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* the fd is already gone; nothing to release */
      }
    }
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
      ? input.tail.map((line) => `  | ${sanitizeLogValue(line)}`).join('\n')
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

  private appendRunner(input: {
    event: 'start' | 'done' | 'failed';
    stepId: string;
    detail?: string;
  }): void {
    fs.appendFileSync(
      this.runnerLogPath,
      `${formatRunnerLogLine({ at: this.now().toISOString(), ...input })}\n`,
    );
  }
}
