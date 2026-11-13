import mongoose from 'mongoose';
import { connectScriptMongo } from '../db/connections';
import {
  HostRateLimiter,
  defaultAxiosRequest,
  fetchPageWithPolicy,
  type HttpRequestFn,
} from '../scrapers/utils/httpFetch';
import {
  HOST_THROTTLE_OVERRIDES,
  resolveHostThrottle,
} from '../scrapers/utils/hostConcurrencyLimiter';
import {
  isMachineHostSlotSharingEnabled,
  machineHostBudgetFor,
  MACHINE_HOST_SLOTS_ENV,
} from '../scrapers/utils/machineHostBudget';
import { readCodeSha } from '../scrapers/scrapeRunCodeIdentity';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { isDirectScriptInvocation } from './directScriptInvocation';
import {
  appliedProbeLoad,
  ProbeUrlSampler,
  chooseProbeHosts,
  classifyProbeRequest,
  formatHostProbeResultLine,
  formatHostProbeTable,
  hostProbeEnvironmentProblems,
  parseHostProbeArgs,
  summarizeHostProbe,
  PROBE_URLS_PER_HOST,
  type HostProbeRequestRecord,
  type HostProbeSummary,
  type ProbeLoad,
} from './hostThrottleProbeCore';

const PER_HOST_IN_FLIGHT = 2;
const PROBE_MIN_INTERVAL_MS = 400;

interface UrlSource {
  collection: string;
  projection: Record<string, 1>;
  urls: (doc: Record<string, unknown>) => unknown[];
}

const URL_SOURCES: UrlSource[] = [
  {
    collection: 'research_entities',
    projection: { websiteUrl: 1, website: 1, sourceUrls: 1 },
    urls: (doc) => [doc.websiteUrl, doc.website, ...asArray(doc.sourceUrls)],
  },
  {
    collection: 'researchers',
    projection: { 'profileLinks.url': 1, 'displayProfile.websiteUrl': 1 },
    urls: (doc) => [
      ...asArray(doc.profileLinks).map((link) => (link as { url?: unknown } | null)?.url),
      (doc.displayProfile as { websiteUrl?: unknown } | undefined)?.websiteUrl,
    ],
  },
];

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function sampleDevelopmentUrls(): Promise<ProbeUrlSampler> {
  const sampler = new ProbeUrlSampler(PROBE_URLS_PER_HOST);
  const db = mongoose.connection.db;
  if (!db) throw new Error('Development connection has no database handle');
  for (const source of URL_SOURCES) {
    const cursor = db
      .collection(source.collection)
      .find({ archived: { $ne: true } }, { projection: source.projection })
      .sort({ _id: 1 });
    for await (const doc of cursor) {
      for (const url of source.urls(doc as Record<string, unknown>)) sampler.add(url);
    }
  }
  return sampler;
}

async function probeUrl(url: string, limiter?: HostRateLimiter): Promise<HostProbeRequestRecord> {
  const statuses: Array<number | null> = [];
  const observingRequest: HttpRequestFn = async (target, config) => {
    try {
      const result = await defaultAxiosRequest(target, config);
      const isRedirectHop = result.status >= 300 && result.status < 400 && !!result.location;
      if (!isRedirectHop) statuses.push(result.status);
      return result;
    } catch (error) {
      statuses.push(null);
      throw error;
    }
  };
  const started = Date.now();
  const succeeded = await fetchPageWithPolicy(url, { request: observingRequest, limiter }).then(
    () => true,
    () => false,
  );
  return {
    firstStatus: statuses[0] ?? null,
    attempts: statuses.length,
    outcome: classifyProbeRequest(statuses, succeeded),
    latencyMs: Date.now() - started,
  };
}

function requestedProbeLoad(host: string, inFlight?: number): ProbeLoad {
  if (inFlight) {
    return {
      inFlight,
      minIntervalMs: HOST_THROTTLE_OVERRIDES[host]?.minIntervalMs ?? PROBE_MIN_INTERVAL_MS,
    };
  }
  const shared = resolveHostThrottle(host, {
    concurrency: PER_HOST_IN_FLIGHT,
    minIntervalMs: PROBE_MIN_INTERVAL_MS,
  });
  return { inFlight: shared.concurrency, minIntervalMs: shared.minIntervalMs };
}

function raisedLoadLimiter(host: string, load: ProbeLoad): HostRateLimiter {
  const inFlight = load.inFlight;
  const machineLimit = machineHostBudgetFor(host).concurrency;
  if (isMachineHostSlotSharingEnabled() && inFlight > machineLimit) {
    // The machine-wide budget would cap the probe below the load it reports having tested.
    throw new Error(
      `--in-flight=${inFlight} exceeds the machine-wide budget of ${machineLimit} for ${host}; run the probe inside a host turn with ${MACHINE_HOST_SLOTS_ENV}=off to measure above it`,
    );
  }
  return new HostRateLimiter({
    maxConcurrency: inFlight,
    minIntervalMs: load.minIntervalMs,
    applyHostOverrides: false,
  });
}

async function probeHost(
  host: string,
  urls: string[],
  urlsInDevelopment: number,
  inFlight?: number,
): Promise<HostProbeSummary> {
  const started = Date.now();
  const records: HostProbeRequestRecord[] = [];
  const requested = requestedProbeLoad(host, inFlight);
  const limiter = inFlight ? raisedLoadLimiter(host, requested) : undefined;
  const load = appliedProbeLoad(
    requested,
    isMachineHostSlotSharingEnabled() ? machineHostBudgetFor(host) : undefined,
  );
  const workers = inFlight ?? PER_HOST_IN_FLIGHT;
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next];
      next += 1;
      records.push(await probeUrl(url, limiter));
    }
  };
  await Promise.all(Array.from({ length: Math.min(workers, urls.length) }, worker));
  const summary = summarizeHostProbe({
    host,
    urlsInDevelopment,
    load,
    records,
    wallTimeMs: Date.now() - started,
  });
  console.log(
    `[host-probe] ${host}: ${summary.inFlight} in flight ${summary.minIntervalMs} ms apart, ${summary.requests} requests, ${summary.firstAttemptRefused} refused on first attempt, ${summary.exhausted} still refused after retries`,
  );
  return summary;
}

export async function runHostThrottleProbe(argv: string[]): Promise<number> {
  const parsed = parseHostProbeArgs(argv);
  const problems = [...parsed.problems, ...hostProbeEnvironmentProblems(process.env)];
  if (problems.length > 0) {
    for (const problem of problems) console.error(`[host-probe] refusing: ${problem}`);
    return 1;
  }

  const startedAt = new Date();
  await connectScriptMongo(process.env.MONGODBURL!);
  let sampler: ProbeUrlSampler;
  try {
    sampler = await sampleDevelopmentUrls();
  } finally {
    await mongoose.disconnect();
  }

  const { host: onlyHost, inFlight } = parsed.options;
  const hosts = onlyHost ? [onlyHost] : chooseProbeHosts(sampler.hostCounts());
  console.log(
    `[host-probe] probing ${hosts.length} hosts, up to ${PROBE_URLS_PER_HOST} pages each at up to ${inFlight ?? PER_HOST_IN_FLIGHT} in flight, read-only`,
  );
  const summaries = await Promise.all(
    hosts.map((host) =>
      probeHost(host, sampler.sampleFor(host), sampler.hostCounts().get(host) ?? 0, inFlight),
    ),
  );
  const wallTimeMs = Date.now() - startedAt.getTime();
  console.log(formatHostProbeTable(summaries));
  console.log(
    formatHostProbeResultLine({
      startedAt: startedAt.toISOString(),
      wallTimeMs,
      codeSha: readCodeSha() ?? null,
      requestedInFlight: inFlight ?? PER_HOST_IN_FLIGHT,
      hosts: summaries,
    }),
  );
  return 0;
}

if (isDirectScriptInvocation(import.meta.url, 'hostThrottleProbe')) {
  runHostThrottleProbe(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`[host-probe] failed: ${sanitizeLogValue(error)}`);
      process.exitCode = 1;
    });
}
