import {
  resolveMongoDatabaseName,
  resolveScraperEnvironment,
} from '../scrapers/scraperEnvironment';
import { DEVELOPMENT_DATABASE_NAME } from './databaseCopyPairs';
import { WEEKLY_SWEEP_FORBIDDEN_VARIABLES } from './weeklyDevelopmentSweepCore';

export const HOST_PROBE_RESULT_MARKER = 'HOST_PROBE_RESULT';

export const ALWAYS_PROBED_HOSTS = ['medicine.yale.edu', 'ysph.yale.edu'] as const;

export const DEFAULT_PROBE_URLS_PER_HOST = 40;

export const DEFAULT_PROBE_EXTRA_HOSTS = 4;

export const PROBE_REFUSAL_STATUSES: ReadonlySet<number> = new Set([403, 429]);

export interface HostProbeArgs {
  perHost: number;
  extraHosts: number;
  hosts: string[];
}

export function parseHostProbeArgs(argv: string[]): HostProbeArgs {
  const args: HostProbeArgs = {
    perHost: DEFAULT_PROBE_URLS_PER_HOST,
    extraHosts: DEFAULT_PROBE_EXTRA_HOSTS,
    hosts: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--' || arg === '--probe-hosts') continue;
    const [flag, inlineValue] = arg.split('=', 2);
    const value = inlineValue ?? argv[(index += 1)];
    if (flag === '--per-host') {
      args.perHost = positiveInteger(flag, value);
    } else if (flag === '--extra-hosts') {
      args.extraHosts = nonNegativeInteger(flag, value);
    } else if (flag === '--hosts') {
      args.hosts = String(value ?? '')
        .split(',')
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean);
    } else {
      throw new Error(`Unknown host probe argument: ${arg}`);
    }
  }
  return args;
}

function positiveInteger(flag: string, value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} needs a positive integer`);
  }
  return parsed;
}

function nonNegativeInteger(flag: string, value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} needs a non-negative integer`);
  }
  return parsed;
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

export function chooseProbeHosts(
  counts: ReadonlyMap<string, number>,
  args: Pick<HostProbeArgs, 'hosts' | 'extraHosts'>,
): string[] {
  if (args.hosts.length > 0) return [...new Set(args.hosts)];
  const chosen: string[] = [...ALWAYS_PROBED_HOSTS];
  const others = [...counts.entries()]
    .filter(([host]) => !chosen.includes(host))
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, args.extraHosts)
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
  const refusedFirst = statuses.length > 0 && isRefusal(statuses[0]);
  if (succeeded) return refusedFirst || statuses.length > 1 ? 'recovered' : 'ok';
  return statuses.some(isRefusal) ? 'exhausted' : 'failed';
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
  hosts: HostProbeSummary[];
}): string {
  return `${HOST_PROBE_RESULT_MARKER} ${JSON.stringify(result)}`;
}
