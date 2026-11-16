import crypto from 'node:crypto';
import fs from 'node:fs';
import { refusedResponseDiagnostics } from './refusedResponseDiagnostics';

export const SCRAPER_REQUEST_LOG_ENV = 'SCRAPER_REQUEST_LOG';

export interface ScraperRequestLogEntry {
  at: string;
  host: string;
  urlHash: string;
  status?: number;
  error?: string;
  durationMs: number;
  attempt: number;
  headers?: Record<string, string>;
  bodyPrefix?: string;
}

export interface ScraperRequestOutcome {
  status?: number;
  error?: string;
  headers?: Record<string, string>;
  bodyPrefix?: string;
}

export interface ScraperRequestLog {
  record: (
    url: string,
    dispatchedAt: Date,
    durationMs: number,
    outcome: ScraperRequestOutcome,
  ) => void;
}

function requestUrlHash(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
}

function requestHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return 'unparseable';
  }
}

interface ResponseLike {
  status?: unknown;
  headers?: unknown;
  data?: unknown;
}

function statusOutcome(response: ResponseLike & { status: number }): ScraperRequestOutcome {
  const diagnostics = refusedResponseDiagnostics(response.status, response.headers, response.data);
  return { status: response.status, ...(diagnostics ?? {}) };
}

export function requestOutcomeOf(result: unknown): ScraperRequestOutcome {
  const response = (result as { response?: ResponseLike } | undefined)?.response;
  if (typeof response?.status === 'number') {
    return statusOutcome(response as ResponseLike & { status: number });
  }
  const status = (result as ResponseLike | undefined)?.status;
  if (typeof status === 'number') return statusOutcome(result as ResponseLike & { status: number });
  const code = (result as { code?: unknown } | undefined)?.code;
  if (typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code)) return { error: code };
  return { error: 'UNKNOWN' };
}

export function createScraperRequestLog(write: (line: string) => void): ScraperRequestLog {
  const attempts = new Map<string, number>();
  return {
    record: (url, dispatchedAt, durationMs, outcome) => {
      const urlHash = requestUrlHash(url);
      const attempt = (attempts.get(urlHash) ?? 0) + 1;
      attempts.set(urlHash, attempt);
      const entry: ScraperRequestLogEntry = {
        at: dispatchedAt.toISOString(),
        host: requestHost(url),
        urlHash,
        ...(outcome.status !== undefined ? { status: outcome.status } : {}),
        ...(outcome.error !== undefined ? { error: outcome.error } : {}),
        durationMs: Math.max(0, Math.round(durationMs)),
        attempt,
        ...(outcome.headers !== undefined ? { headers: outcome.headers } : {}),
        ...(outcome.bodyPrefix !== undefined ? { bodyPrefix: outcome.bodyPrefix } : {}),
      };
      write(`${JSON.stringify(entry)}\n`);
    },
  };
}

/**
 * Opt-in: `SCRAPER_REQUEST_LOG=<path>` appends one line per request to a file only its owner can
 * read, so a run can be lined up against a host incident. Only a refused (403 or 429) response adds
 * allowlisted headers and a redacted body prefix (`refusedResponseDiagnostics.ts`).
 */
export function scraperRequestLogFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  warn: (message: string) => void = console.warn,
): ScraperRequestLog | undefined {
  const target = env[SCRAPER_REQUEST_LOG_ENV]?.trim();
  if (!target) return undefined;
  let fd: number | undefined;
  try {
    fd = fs.openSync(target, 'a', 0o600);
    fs.fchmodSync(fd, 0o600);
  } catch (error) {
    if (fd !== undefined) fs.closeSync(fd);
    warn(
      `[scraper-request-log] ${SCRAPER_REQUEST_LOG_ENV} could not be opened (${openErrorCode(error)}); this run is not request-logged`,
    );
    return undefined;
  }
  const opened = fd;
  return createScraperRequestLog((line) => fs.writeSync(opened, line));
}

let processRequestLog: { log: ScraperRequestLog | undefined } | undefined;

export function processScraperRequestLog(): ScraperRequestLog | undefined {
  processRequestLog ??= { log: scraperRequestLogFromEnv() };
  return processRequestLog.log;
}

function openErrorCode(error: unknown): string {
  const code = (error as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code) ? code : 'UNKNOWN';
}
