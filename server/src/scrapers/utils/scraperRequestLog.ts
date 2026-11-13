import crypto from 'node:crypto';
import fs from 'node:fs';

export const SCRAPER_REQUEST_LOG_ENV = 'SCRAPER_REQUEST_LOG';

export interface ScraperRequestLogEntry {
  at: string;
  host: string;
  urlHash: string;
  status?: number;
  error?: string;
  durationMs: number;
  attempt: number;
}

export interface ScraperRequestOutcome {
  status?: number;
  error?: string;
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

export function requestOutcomeOf(result: unknown): ScraperRequestOutcome {
  const response = (result as { response?: { status?: unknown } } | undefined)?.response;
  if (typeof response?.status === 'number') return { status: response.status };
  const status = (result as { status?: unknown } | undefined)?.status;
  if (typeof status === 'number') return { status };
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
      };
      write(`${JSON.stringify(entry)}\n`);
    },
  };
}

/**
 * Opt-in: `SCRAPER_REQUEST_LOG=<path>` appends one line per request to a file only its owner can
 * read, so a run can be lined up against a host incident without reading headers or bodies.
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
