import mongoose from 'mongoose';
import { connectScriptMongo } from '../db/connections';
import {
  defaultAxiosRequest,
  fetchPageWithPolicy,
  type HttpRequestFn,
} from '../scrapers/utils/httpFetch';
import { readCodeSha } from '../scrapers/scrapeRunCodeIdentity';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { isDirectScriptInvocation } from './directScriptInvocation';
import {
  ProbeUrlSampler,
  chooseProbeHosts,
  classifyProbeRequest,
  formatHostProbeResultLine,
  formatHostProbeTable,
  hostProbeArgumentProblems,
  hostProbeEnvironmentProblems,
  summarizeHostProbe,
  PROBE_URLS_PER_HOST,
  type HostProbeRequestRecord,
  type HostProbeSummary,
} from './hostThrottleProbeCore';

const PER_HOST_IN_FLIGHT = 2;

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

async function probeUrl(url: string): Promise<HostProbeRequestRecord> {
  const statuses: Array<number | null> = [];
  const observingRequest: HttpRequestFn = async (target, config) => {
    try {
      const result = await defaultAxiosRequest(target, config);
      statuses.push(result.status);
      return result;
    } catch (error) {
      statuses.push(null);
      throw error;
    }
  };
  const started = Date.now();
  const succeeded = await fetchPageWithPolicy(url, { request: observingRequest }).then(
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

async function probeHost(
  host: string,
  urls: string[],
  urlsInDevelopment: number,
): Promise<HostProbeSummary> {
  const started = Date.now();
  const records: HostProbeRequestRecord[] = [];
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next];
      next += 1;
      records.push(await probeUrl(url));
    }
  };
  await Promise.all(Array.from({ length: Math.min(PER_HOST_IN_FLIGHT, urls.length) }, worker));
  const summary = summarizeHostProbe({
    host,
    urlsInDevelopment,
    records,
    wallTimeMs: Date.now() - started,
  });
  console.log(
    `[host-probe] ${host}: ${summary.requests} requests, ${summary.firstAttemptRefused} refused on first attempt, ${summary.exhausted} still refused after retries`,
  );
  return summary;
}

export async function runHostThrottleProbe(argv: string[]): Promise<number> {
  const problems = [
    ...hostProbeArgumentProblems(argv),
    ...hostProbeEnvironmentProblems(process.env),
  ];
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

  const hosts = chooseProbeHosts(sampler.hostCounts());
  console.log(
    `[host-probe] probing ${hosts.length} hosts, up to ${PROBE_URLS_PER_HOST} pages each, read-only`,
  );
  const summaries = await Promise.all(
    hosts.map((host) =>
      probeHost(host, sampler.sampleFor(host), sampler.hostCounts().get(host) ?? 0),
    ),
  );
  const wallTimeMs = Date.now() - startedAt.getTime();
  console.log(formatHostProbeTable(summaries));
  console.log(
    formatHostProbeResultLine({
      startedAt: startedAt.toISOString(),
      wallTimeMs,
      codeSha: readCodeSha() ?? null,
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
