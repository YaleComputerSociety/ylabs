import fs from 'fs';
import path from 'path';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { sanitizeLogValue } from '../utils/logSanitizer';

export const DEFAULT_ERROR_LOG_TAIL_LINES = 40;
export const DEFAULT_LOG_TAIL_BYTES = 64 * 1024;
export const FAILURE_TAIL_LINES = 30;
export const FAILURE_TAIL_MAX_CHARS = 2048;
const ARTIFACT_SUMMARY_MAX_CHARS = 512;
const ARTIFACT_SUMMARY_STRING_FIELDS = new Set(['status', 'mode', 'error', 'reason']);

const LABELLED_NETID_RE = /\b(net_?id)(\s*[:=]\s*["'`]?)[a-z]{2,4}\d{1,4}\b/gi;
const PERSON_FIELD_JSON_RE =
  /("(?:name|fname|lname|firstName|lastName|fullName|displayName|label|slug|title|netid|netId|email|piName|leadName)"\s*:\s*)"(?:\\.|[^"\\])*"/g;
const HTTP_URL_PATH_RE = /\b(https?:\/\/[^\s/"'<>]+)\/[^\s"'<>)\]]+/gi;

/**
 * A stored tail is kept in Development and printed to the hosted log, so it carries no
 * contact detail, netid, person-bearing field value, or URL path, which on this corpus is
 * usually a person's profile slug.
 */
export function redactFailureTailLine(line: string): string {
  return redactDirectContactInfo(sanitizeLogValue(line))
    .replace(LABELLED_NETID_RE, '$1$2[netid redacted]')
    .replace(PERSON_FIELD_JSON_RE, '$1"[redacted]"')
    .replace(HTTP_URL_PATH_RE, '$1/[path redacted]');
}

function keepEnd(text: string, maxChars: number): string {
  return text.length > maxChars ? `...${text.slice(-(maxChars - 3))}` : text;
}

export function summarizeFailedArtifact(artifactPath: string | undefined): string | undefined {
  if (!artifactPath) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const summary: Record<string, unknown> = {};
  const collect = (record: Record<string, unknown>, prefix: string) => {
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === 'number' || typeof value === 'boolean') {
        summary[`${prefix}${key}`] = value;
      } else if (typeof value === 'string' && ARTIFACT_SUMMARY_STRING_FIELDS.has(key)) {
        summary[`${prefix}${key}`] = value.slice(0, 200);
      }
    }
  };
  const record = parsed as Record<string, unknown>;
  collect(record, '');
  for (const nested of ['result', 'counts']) {
    const value = record[nested];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      collect(value as Record<string, unknown>, `${nested}.`);
    }
  }
  if (Object.keys(summary).length === 0) return undefined;
  return keepEnd(
    `artifact: ${redactFailureTailLine(JSON.stringify(summary))}`,
    ARTIFACT_SUMMARY_MAX_CHARS,
  );
}

export function buildFailureTail(input: {
  logPath?: string;
  artifactPath?: string;
  maxChars?: number;
}): string | undefined {
  const logText = readLogTail(input.logPath, FAILURE_TAIL_LINES)
    .map(redactFailureTailLine)
    .join('\n');
  const artifact = summarizeFailedArtifact(input.artifactPath);
  const maxChars = input.maxChars ?? FAILURE_TAIL_MAX_CHARS;
  if (!artifact) return logText ? keepEnd(logText, maxChars) : undefined;
  const room = maxChars - artifact.length - 1;
  return logText && room > 3 ? `${artifact}\n${keepEnd(logText, room)}` : artifact;
}

export function formatFailureTailForLog(tail: string | undefined): string {
  return tail
    ? tail
        .split('\n')
        .map((line) => `  | ${line}`)
        .join('\n')
    : '  | (no captured output)';
}

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
