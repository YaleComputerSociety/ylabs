import {
  resolveMongoDatabaseName,
  resolveScraperEnvironment,
} from '../scrapers/scraperEnvironment';
import { DEVELOPMENT_DATABASE_NAME } from './databaseCopyPairs';
import { WEEKLY_SWEEP_FORBIDDEN_VARIABLES } from './weeklyDevelopmentSweepCore';

export const HOST_PROBE_RESULT_MARKER = 'HOST_PROBE_RESULT';

export const ALWAYS_PROBED_HOSTS = ['medicine.yale.edu', 'ysph.yale.edu'] as const;

export const PROBE_URLS_PER_HOST = 40;

export const PROBE_EXTRA_HOSTS = 4;

export const PROBE_REFUSAL_STATUSES: ReadonlySet<number> = new Set([403, 429]);

export const PROBE_MAX_IN_FLIGHT = 4;

export interface HostProbeOptions {
  host?: string;
  inFlight?: number;
}

export function parseHostProbeArgs(argv: string[]): {
  options: HostProbeOptions;
  problems: string[];
} {
  const options: HostProbeOptions = {};
  const problems: string[] = [];
  for (const arg of argv) {
    if (arg === '--') continue;
    if (arg.startsWith('--host=')) {
      const host = arg.slice('--host='.length).trim().toLowerCase();
      if (!isYaleHost(host))
        problems.push(`--host must name a yale.edu host; got ${host || 'nothing'}`);
      else options.host = host;
    } else if (arg.startsWith('--in-flight=')) {
      const inFlight = Number(arg.slice('--in-flight='.length));
      if (!Number.isInteger(inFlight) || inFlight < 1 || inFlight > PROBE_MAX_IN_FLIGHT) {
        problems.push(`--in-flight must be an integer from 1 to ${PROBE_MAX_IN_FLIGHT}`);
      } else {
        options.inFlight = inFlight;
      }
    } else {
      problems.push(
        `Unknown host probe argument: ${arg}; the probe takes only --host=<host> and --in-flight=<n>`,
      );
    }
  }
  if (
    options.inFlight !== undefined &&
    !options.host &&
    !problems.some((p) => p.startsWith('--host'))
  ) {
    problems.push('--in-flight needs --host, so a raised load reaches one host only');
  }
  return { options, problems };
}

export function hostProbeArgumentProblems(argv: string[]): string[] {
  return parseHostProbeArgs(argv).problems;
}

export function hostProbeEnvironmentProblems(env: NodeJS.ProcessEnv): string[] {
  const problems: string[] = [];
  if (!String(env.MONGODBURL ?? '').trim()) problems.push('MONGODBURL is required and is not set');
  for (const name of WEEKLY_SWEEP_FORBIDDEN_VARIABLES) {
    if (String(env[name] ?? '').trim()) {
      problems.push(`${name} is set; the host probe reads Development only, so remove it`);
    }
  }
  const environment = resolveScraperEnvironment(env);
  if (environment !== 'development') {
    problems.push(`SCRAPER_ENV must resolve to development; resolved ${environment}`);
  }
  const database = resolveMongoDatabaseName(env.MONGODBURL);
  if (env.MONGODBURL && database !== DEVELOPMENT_DATABASE_NAME) {
    problems.push(
      `MONGODBURL must name database ${DEVELOPMENT_DATABASE_NAME}; resolved ${database ?? 'none'}`,
    );
  }
  return problems;
}

export function isYaleHost(host: string): boolean {
  return host === 'yale.edu' || host.endsWith('.yale.edu');
}

export function probeUrlHost(url: unknown): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

export class ProbeUrlSampler {
  private readonly counts = new Map<string, number>();
  private readonly samples = new Map<string, string[]>();
  private readonly seen = new Set<string>();

  constructor(private readonly perHost: number) {}

  add(url: unknown): void {
    const host = probeUrlHost(url);
    if (!host || !isYaleHost(host)) return;
    const normalized = String(url).trim();
    if (this.seen.has(normalized)) return;
    this.seen.add(normalized);
    this.counts.set(host, (this.counts.get(host) ?? 0) + 1);
    const sample = this.samples.get(host) ?? [];
    if (sample.length < this.perHost) {
      sample.push(normalized);
      this.samples.set(host, sample);
    }
  }

  hostCounts(): ReadonlyMap<string, number> {
    return this.counts;
  }

  sampleFor(host: string): string[] {
    return this.samples.get(host) ?? [];
  }
}

export function chooseProbeHosts(counts: ReadonlyMap<string, number>): string[] {
  const chosen: string[] = [...ALWAYS_PROBED_HOSTS];
  const others = [...counts.entries()]
    .filter(([host]) => !chosen.includes(host))
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, PROBE_EXTRA_HOSTS)
    .map(([host]) => host);
  return [...chosen, ...others];
}

export type HostProbeOutcome = 'ok' | 'recovered' | 'exhausted' | 'failed';

export interface HostProbeRequestRecord {
  firstStatus: number | null;
  attempts: number;
  outcome: HostProbeOutcome;
  latencyMs: number;
}

export function classifyProbeRequest(
  statuses: Array<number | null>,
  succeeded: boolean,
): HostProbeOutcome {
  if (succeeded) return statuses.some(isRefusal) ? 'recovered' : 'ok';
  const lastAnswered = statuses.filter((status) => status !== null).at(-1);
  return isRefusal(lastAnswered) ? 'exhausted' : 'failed';
}

function isRefusal(status: number | null | undefined): boolean {
  return typeof status === 'number' && PROBE_REFUSAL_STATUSES.has(status);
}

export interface HostProbeSummary {
  host: string;
  urlsInDevelopment: number;
  requests: number;
  attempts: number;
  firstAttemptRefused: number;
  firstAttemptRefusedRate: number;
  ok: number;
  recovered: number;
  exhausted: number;
  failed: number;
  medianLatencyMs: number | null;
  p95LatencyMs: number | null;
  wallTimeMs: number;
}

export function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[rank];
}

export function summarizeHostProbe(input: {
  host: string;
  urlsInDevelopment: number;
  records: HostProbeRequestRecord[];
  wallTimeMs: number;
}): HostProbeSummary {
  const { records } = input;
  const count = (outcome: HostProbeOutcome) =>
    records.filter((record) => record.outcome === outcome).length;
  const firstAttemptRefused = records.filter((record) => isRefusal(record.firstStatus)).length;
  const latencies = records.map((record) => record.latencyMs);
  return {
    host: input.host,
    urlsInDevelopment: input.urlsInDevelopment,
    requests: records.length,
    attempts: records.reduce((total, record) => total + record.attempts, 0),
    firstAttemptRefused,
    firstAttemptRefusedRate: records.length ? round(firstAttemptRefused / records.length) : 0,
    ok: count('ok'),
    recovered: count('recovered'),
    exhausted: count('exhausted'),
    failed: count('failed'),
    medianLatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    wallTimeMs: input.wallTimeMs,
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function formatHostProbeTable(summaries: HostProbeSummary[]): string {
  const header = [
    'host',
    'requests',
    'first 403/429',
    'recovered',
    'exhausted',
    'other failed',
    'median ms',
    'p95 ms',
    'wall s',
  ];
  const rows = summaries.map((summary) => [
    summary.host,
    String(summary.requests),
    `${summary.firstAttemptRefused} (${Math.round(summary.firstAttemptRefusedRate * 100)}%)`,
    String(summary.recovered),
    String(summary.exhausted),
    String(summary.failed),
    summary.medianLatencyMs === null ? '-' : String(summary.medianLatencyMs),
    summary.p95LatencyMs === null ? '-' : String(summary.p95LatencyMs),
    String(Math.round(summary.wallTimeMs / 1000)),
  ]);
  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...rows.map((row) => row[column].length)),
  );
  const line = (cells: string[]) =>
    `| ${cells.map((cell, column) => cell.padEnd(widths[column])).join(' | ')} |`;
  return [
    line(header),
    `|${widths.map((width) => '-'.repeat(width + 2)).join('|')}|`,
    ...rows.map(line),
  ].join('\n');
}

export function formatHostProbeResultLine(result: {
  startedAt: string;
  wallTimeMs: number;
  codeSha: string | null;
  inFlight?: number;
  hosts: HostProbeSummary[];
}): string {
  return `${HOST_PROBE_RESULT_MARKER} ${JSON.stringify(result)}`;
}
