/**
 * departments:audit-roster-lanes - measures whether each `dept-faculty-roster`
 * lane still reads its whole roster (#2817).
 *
 * The scraper's own health check sets `status: 'ok'` for any non-zero row count,
 * so a lane reading 12 rows of 168 reports the same thing as a lane reading all
 * of them, and no expected roster size is recorded anywhere. This runs the three
 * probes `skills/scrapers/SKILL.md` documents, against every lane:
 *
 *   1. Redirect - where the configured URL actually lands, so a `/people` root
 *      that 301s into one tab of a tabbed roster is visible.
 *   2. Sibling tabs - faculty-shaped people tabs in the same subtree that no
 *      config covers.
 *   3. Pager - walks `?page=N` with the lane's OWN extractor, stopping on a
 *      repeated page rather than an empty one.
 *
 * Read-only: touches no database and writes nothing but its report. Every fetch
 * goes through `fetchPageWithPolicy`, so `HostConcurrencyLimiter` caps load per
 * host and `--concurrency` fans out across the 59 distinct hosts without
 * exceeding any single host's budget.
 *
 *   yarn --cwd server departments:audit-roster-lanes
 *   yarn --cwd server departments:audit-roster-lanes --only=law,history
 *   yarn --cwd server departments:audit-roster-lanes --output=./tmp/roster-lanes.json
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DEFAULT_DEPT_CONFIGS } from '../scrapers/sources/departmentRosterScraper';
import { rosterEntryIdentityKey, walkRosterLanePages } from '../scrapers/sources/rosterLanePaging';
import { runWithBoundedConcurrency } from '../scrapers/utils/boundedConcurrency';
import { fetchPageWithPolicy } from '../scrapers/utils/httpFetch';
import { classifySourceLinkHealth, probeSourceLink } from '../services/sourceLinkHealth';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  ROSTER_LANE_AUDIT_ALARM_EXIT_CODE,
  siblingPeopleTabUrls,
  siblingTabFacultyGapKeys,
  summarizeRosterLaneAudit,
  uncoveredSiblingTabs,
  type RosterLaneEvidence,
} from './auditRosterLanesCore';

const DEFAULT_LANE_CONCURRENCY = 8;

export interface RosterLaneAuditOptions {
  output?: string;
  only?: Set<string>;
  concurrency: number;
}

export function parseRosterLaneAuditArgs(argv: string[]): RosterLaneAuditOptions {
  let output: string | undefined;
  let only: Set<string> | undefined;
  let concurrency = DEFAULT_LANE_CONCURRENCY;
  for (const arg of argv) {
    if (arg.startsWith('--output=')) {
      output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else if (arg.startsWith('--only=')) {
      const keys = arg
        .slice('--only='.length)
        .split(',')
        .map((key) => key.trim().toLowerCase())
        .filter(Boolean);
      if (keys.length === 0) throw new Error('--only requires at least one deptKey');
      only = new Set(keys);
    } else if (arg.startsWith('--concurrency=')) {
      const raw = Number(arg.slice('--concurrency='.length));
      if (!Number.isInteger(raw) || raw < 1) {
        throw new Error(`--concurrency requires a positive integer; received ${raw}`);
      }
      concurrency = raw;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { output, only, concurrency };
}

type DeptConfigRow = (typeof DEFAULT_DEPT_CONFIGS)[number];

interface LaneAuditResult {
  evidence: RosterLaneEvidence;
  /** Identity keys this lane read, for host-level alias resolution. */
  peopleKeys: string[];
  /** Sibling tabs no config covers by URL, still to be checked for aliasing. */
  candidateTabUrls: string[];
  extractor: DeptConfigRow['extractor'];
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return url;
  }
}

async function auditLane(
  config: DeptConfigRow,
  configuredUrls: readonly string[],
): Promise<LaneAuditResult> {
  const base: RosterLaneEvidence = {
    deptKey: config.deptKey,
    deptName: config.deptName,
    schoolName: config.schoolName,
    url: config.url,
    paginated: Boolean(config.paginated),
    jsRendered: Boolean(config.jsRenderedSkip),
    reachability: 'UNKNOWN',
    peopleRead: 0,
    rowsRead: 0,
    pagesFetched: 0,
    uncoveredSiblingTabUrls: [],
  };

  // Probe first, so a blocked or retired URL is classified as unreachable rather
  // than reaching the extractor and reading as an empty roster.
  const probe = await probeSourceLink(config.url);
  const health = classifySourceLinkHealth(probe);
  base.reachability = health.healthStatus;
  if (health.httpStatusCode !== undefined) base.httpStatusCode = health.httpStatusCode;
  if (probe.finalUrl && probe.finalUrl !== config.url) base.landedUrl = probe.finalUrl;

  let firstPageHtml = '';
  const walk = await walkRosterLanePages({
    url: config.url,
    paginated: config.paginated,
    extractor: config.extractor,
    fetchHtml: async (pageUrl) => {
      const page = await fetchPageWithPolicy(pageUrl);
      if (!firstPageHtml) firstPageHtml = page.html;
      // The fetch resolves redirects too, and it is the more reliable witness of
      // where the configured URL landed because it followed them to get the HTML.
      if (!base.landedUrl && page.url && page.url !== pageUrl) base.landedUrl = page.url;
      return page.html;
    },
  });

  base.peopleRead = walk.distinctEntries.length;
  base.rowsRead = walk.pages.reduce((total, page) => total + page.entries.length, 0);
  base.pagesFetched = walk.pagesFetched;
  base.pagerStopReason = walk.stopReason;
  if (walk.error) base.error = String(sanitizeLogValue(walk.error));

  const candidateTabUrls = firstPageHtml
    ? uncoveredSiblingTabs(
        siblingPeopleTabUrls(firstPageHtml, base.landedUrl ?? config.url),
        configuredUrls,
      )
    : [];

  return {
    evidence: base,
    peopleKeys: walk.distinctEntries.map(rosterEntryIdentityKey).filter(Boolean),
    candidateTabUrls,
    extractor: config.extractor,
  };
}

/**
 * Resolves candidate sibling tabs against what every configured lane on that host
 * actually read, dropping the ones that only re-list people already covered.
 */
async function resolveSiblingTabAliases(
  results: readonly LaneAuditResult[],
  concurrency: number,
): Promise<void> {
  const peopleByHost = new Map<string, Set<string>>();
  for (const result of results) {
    const host = hostOf(result.evidence.url);
    const covered = peopleByHost.get(host) ?? new Set<string>();
    for (const key of result.peopleKeys) covered.add(key);
    peopleByHost.set(host, covered);
  }

  const candidates = results.flatMap((result) =>
    result.candidateTabUrls.map((url) => ({ url, result })),
  );
  const genuinelyUncovered = new Map<string, boolean>();

  await runWithBoundedConcurrency(candidates, concurrency, async ({ url, result }) => {
    if (genuinelyUncovered.has(url)) return;
    const covered = peopleByHost.get(hostOf(url)) ?? new Set<string>();
    try {
      const page = await fetchPageWithPolicy(url);
      const entries = result.extractor(page.html, { pageUrl: page.url || url }).map((entry) => ({
        ...(entry.title ? { title: entry.title } : {}),
        identityKey: rosterEntryIdentityKey(entry),
      }));
      genuinelyUncovered.set(url, siblingTabFacultyGapKeys(entries, covered).length > 0);
    } catch {
      // A tab that cannot be read is not evidence of a gap; leave it unreported
      // rather than sending somebody to add a lane for a page that does not answer.
      genuinelyUncovered.set(url, false);
    }
  });

  for (const result of results) {
    result.evidence.uncoveredSiblingTabUrls = result.candidateTabUrls.filter(
      (url) => genuinelyUncovered.get(url) === true,
    );
  }
}

async function main() {
  const options = parseRosterLaneAuditArgs(process.argv.slice(2));
  const configuredUrls = DEFAULT_DEPT_CONFIGS.map((config) => config.url);
  const lanes = options.only
    ? DEFAULT_DEPT_CONFIGS.filter((config) => options.only!.has(config.deptKey.toLowerCase()))
    : DEFAULT_DEPT_CONFIGS;
  if (options.only) {
    // A partially matched filter is the same silent under-read this audit exists
    // to catch, so an unknown deptKey fails the run rather than auditing fewer
    // lanes than were asked for.
    const known = new Set(DEFAULT_DEPT_CONFIGS.map((config) => config.deptKey.toLowerCase()));
    const unknown = Array.from(options.only).filter((key) => !known.has(key));
    if (unknown.length > 0) {
      throw new Error(`--only names no roster config: ${unknown.sort().join(', ')}`);
    }
  }
  if (lanes.length === 0) throw new Error('--only matched no roster config');

  const results: LaneAuditResult[] = [];
  await runWithBoundedConcurrency(lanes, options.concurrency, async (config) => {
    try {
      results.push(await auditLane(config, configuredUrls));
    } catch (error) {
      results.push({
        evidence: {
          deptKey: config.deptKey,
          deptName: config.deptName,
          schoolName: config.schoolName,
          url: config.url,
          paginated: Boolean(config.paginated),
          jsRendered: Boolean(config.jsRenderedSkip),
          reachability: 'UNKNOWN',
          peopleRead: 0,
          rowsRead: 0,
          pagesFetched: 0,
          uncoveredSiblingTabUrls: [],
          error: String(sanitizeLogValue(error)),
        },
        peopleKeys: [],
        candidateTabUrls: [],
        extractor: config.extractor,
      });
    }
  });

  await resolveSiblingTabAliases(results, options.concurrency);

  const report = summarizeRosterLaneAudit(results.map((result) => result.evidence));
  const output = { mode: 'audit', concurrency: options.concurrency, ...report };
  console.log(JSON.stringify(output, null, 2));
  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(output, null, 2)}\n`);
  }

  if (report.status === 'findings') {
    process.exitCode = ROSTER_LANE_AUDIT_ALARM_EXIT_CODE;
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  dotenv.config();
  main().catch((error) => {
    console.error('Failed to audit roster lanes:', sanitizeLogValue(error));
    process.exitCode = 1;
  });
}
