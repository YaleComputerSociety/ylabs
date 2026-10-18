import axios from 'axios';

export const SCRAPE_RUN_STALL_WINDOW_MS = 20 * 60 * 1000;

export const SCRAPE_RUN_STALL_WINDOW_ENV = 'SCRAPER_RUN_STALL_WINDOW_MS';

// Scripts otherwise connect with no socket timeout, and the driver interrupts an in-use
// connection only when a monitor check *times out*. A lost network fails the monitor with
// ENOTFOUND instead, so an operation in flight on the dead socket can wait forever, the
// likeliest hang in #5086.
// Kept under the stall window so the operation fails and is retried before the run is
// declared stalled.
export const SCRAPE_RUN_SOCKET_TIMEOUT_MS = 10 * 60 * 1000;

export const SCRAPE_RUN_STALLED_LOG_TAG = '[scrape-run-stalled]';

let lastProgressAtMs = Date.now();

export function recordScrapeRunProgress(atMs: number = Date.now()): void {
  lastProgressAtMs = atMs;
}

export function lastScrapeRunProgressAtMs(): number {
  return lastProgressAtMs;
}

export async function withScrapeRunProgress<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } finally {
    recordScrapeRunProgress();
  }
}

export function resolveScrapeRunStallWindowMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[SCRAPE_RUN_STALL_WINDOW_ENV]?.trim();
  if (!raw) return SCRAPE_RUN_STALL_WINDOW_MS;
  const parsed = Number(raw);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  console.warn(
    `Ignoring ${SCRAPE_RUN_STALL_WINDOW_ENV}=${JSON.stringify(raw)}: it must be a positive whole number of milliseconds, so the ${SCRAPE_RUN_STALL_WINDOW_MS} ms default applies.`,
  );
  return SCRAPE_RUN_STALL_WINDOW_MS;
}

let axiosProgressInstalled = false;

// Lanes and LLM extractors call the shared axios instance directly rather than through
// fetchPageWithPolicy, so a settled request is counted where every one of them passes.
export function installAxiosScrapeRunProgress(): void {
  if (axiosProgressInstalled) return;
  axiosProgressInstalled = true;
  axios.interceptors.response.use(
    (response) => {
      recordScrapeRunProgress();
      return response;
    },
    (error) => {
      recordScrapeRunProgress();
      return Promise.reject(error);
    },
  );
}

export interface ScrapeRunStall {
  sourceName: string;
  lastProgressAt: Date;
  detectedAt: Date;
  stallWindowMs: number;
}

export function scrapeRunStallMessage(stall: ScrapeRunStall): string {
  const minutes = Math.round(stall.stallWindowMs / 60_000);
  return (
    `${SCRAPE_RUN_STALLED_LOG_TAG} ${stall.sourceName} made no progress for more than ${minutes} minute(s) ` +
    `(last progress at ${stall.lastProgressAt.toISOString()}), so the run was stopped as interrupted (stalled) ` +
    'rather than heartbeating a process whose work has hung'
  );
}

export class ScrapeRunStalledError extends Error {
  constructor(readonly stall: ScrapeRunStall) {
    super(scrapeRunStallMessage(stall));
    this.name = 'ScrapeRunStalledError';
  }
}

export function matchesScrapeRunStallText(text: string | undefined): boolean {
  return typeof text === 'string' && text.includes(SCRAPE_RUN_STALLED_LOG_TAG);
}
