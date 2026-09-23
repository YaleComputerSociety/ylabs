/**
 * research-homes:audit-rosters - the structural and sampled-precision gate the
 * docs required before `official-research-home-roster` may be enabled beyond its
 * reviewed allowlist (#2412).
 *
 * Four documents named this command as the enablement criterion and it did not
 * exist, so the criterion was unmeetable: either the source stayed disabled or
 * somebody enabled it without the review the docs promised. #2411 retracted the
 * claims; this restores them.
 *
 * It reads each configured roster page with the source's OWN extractor, so the
 * audit cannot disagree with the scraper about what a page yields, and joins the
 * result to what the corpus actually stored. Read-only: it writes nothing but its
 * `--output` report.
 *
 *   yarn --cwd server research-homes:audit-rosters
 *   yarn --cwd server research-homes:audit-rosters --only=ysm-turk
 *   yarn --cwd server research-homes:audit-rosters --strict \
 *     --sampled-precision-reviewed-by="<reviewer>" --sample-limit=20 \
 *     --output="$TMPDIR/roster-gate.json"
 *
 * `--strict` exits non-zero until the structural checks are clean AND a sampled
 * precision review is recorded, because structure cannot tell whether a mapped
 * role is honest. Sample rows carry a member's own name and title, so they land
 * only in the write-guarded report file, never on stdout.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import * as cheerio from 'cheerio';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { RoleAssignment } from '../models/roleAssignment';
import {
  OFFICIAL_RESEARCH_HOME_ROSTER_SOURCE,
  OFFICIAL_ROSTER_CONFIGS,
  OFFICIAL_ROSTER_MAX_PUBLISH_AGE_DAYS,
  extractOfficialResearchHomeRoster,
  type OfficialRosterConfig,
} from '../scrapers/sources/officialResearchHomeRosterScraper';
import { fetchPageWithPolicy } from '../scrapers/utils/httpFetch';
import { classifySourceLinkHealth, probeSourceLink } from '../services/sourceLinkHealth';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  RESEARCH_HOME_ROSTER_AUDIT_ALARM_EXIT_CODE,
  RESEARCH_HOME_ROSTER_MAX_SAMPLE,
  summarizeResearchHomeRosterAudit,
  type OfficialRosterLaneEvidence,
} from './auditResearchHomeRostersCore';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ResearchHomeRosterAuditOptions {
  output?: string;
  only?: Set<string>;
  strict: boolean;
  sampledPrecisionReviewedBy?: string;
  sampleLimit: number;
}

export function parseResearchHomeRosterAuditArgs(argv: string[]): ResearchHomeRosterAuditOptions {
  const options: ResearchHomeRosterAuditOptions = { strict: false, sampleLimit: 0 };
  for (const arg of argv) {
    if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else if (arg.startsWith('--only=')) {
      const keys = arg
        .slice('--only='.length)
        .split(',')
        .map((key) => key.trim().toLowerCase())
        .filter(Boolean);
      if (keys.length === 0) throw new Error('--only requires at least one researchEntityKey');
      options.only = new Set(keys);
    } else if (arg === '--strict') {
      options.strict = true;
    } else if (arg.startsWith('--sampled-precision-reviewed-by=')) {
      const reviewer = arg.slice('--sampled-precision-reviewed-by='.length).trim();
      if (!reviewer) throw new Error('--sampled-precision-reviewed-by requires a reviewer');
      options.sampledPrecisionReviewedBy = reviewer;
    } else if (arg.startsWith('--sample-limit=')) {
      const raw = Number(arg.slice('--sample-limit='.length));
      if (!Number.isInteger(raw) || raw < 0 || raw > RESEARCH_HOME_ROSTER_MAX_SAMPLE) {
        throw new Error(
          `--sample-limit requires an integer between 0 and ${RESEARCH_HOME_ROSTER_MAX_SAMPLE}; received ${arg.slice('--sample-limit='.length)}`,
        );
      }
      options.sampleLimit = raw;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  // A sample carries member names and titles, so it has nowhere safe to go without
  // a report file and the request is refused rather than quietly downgraded.
  if (options.sampleLimit > 0 && !options.output) {
    throw new Error('--sample-limit requires --output, because sample rows carry member names');
  }
  return options;
}

export function selectRosterConfigs(
  configs: readonly OfficialRosterConfig[],
  only: Set<string> | undefined,
): OfficialRosterConfig[] {
  if (!only) return [...configs];
  const known = new Set(configs.map((config) => config.researchEntityKey.toLowerCase()));
  const unknown = Array.from(only).filter((key) => !known.has(key));
  if (unknown.length > 0) {
    throw new Error(`--only names no roster config: ${unknown.sort().join(', ')}`);
  }
  return configs.filter((config) => only.has(config.researchEntityKey.toLowerCase()));
}

function sectionLabelsOnPage(html: string): string[] {
  const $ = cheerio.load(html);
  const labels: string[] = [];
  $('section.organization-member-listing').each((_index, element) => {
    const section = $(element);
    const label = (section.attr('aria-label') || section.find('h2,h3').first().text() || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (label) labels.push(label.slice(0, 120));
  });
  return labels;
}

async function readStoredLaneState(
  config: OfficialRosterConfig,
): Promise<
  Pick<
    OfficialRosterLaneEvidence,
    | 'entityExists'
    | 'entityArchived'
    | 'storedSnapshotState'
    | 'storedMembershipKeys'
    | 'storedObservedAt'
    | 'storedFreshnessExpiresAt'
    | 'materializedMembershipKeys'
    | 'expiredMaterializedRows'
  >
> {
  const entity = await ResearchEntity.findOne({ slug: config.researchEntityKey })
    .select('_id archived rosterEnrichment')
    .lean();
  const snapshot = (entity as { rosterEnrichment?: Record<string, unknown> } | null)
    ?.rosterEnrichment;
  const storedMembershipKeys = Array.isArray(snapshot?.memberKeys)
    ? (snapshot!.memberKeys as unknown[]).map((key) => String(key))
    : [];
  const entityId = (entity as { _id?: unknown } | null)?._id;
  const roleRows = entityId
    ? await RoleAssignment.find({
        'rosterProvenance.sourceName': OFFICIAL_RESEARCH_HOME_ROSTER_SOURCE,
        'target.id': entityId,
        state: 'CURRENT',
        archived: { $ne: true },
      })
        .select('rosterProvenance')
        .lean()
    : [];
  const now = Date.now();
  const provenance = roleRows.map(
    (row) => (row as { rosterProvenance?: Record<string, unknown> }).rosterProvenance ?? {},
  );
  return {
    entityExists: Boolean(entity),
    entityArchived: Boolean((entity as { archived?: boolean } | null)?.archived),
    ...(typeof snapshot?.state === 'string' ? { storedSnapshotState: snapshot.state } : {}),
    storedMembershipKeys,
    ...(snapshot?.observedAt ? { storedObservedAt: String(snapshot.observedAt) } : {}),
    ...(snapshot?.freshnessExpiresAt
      ? { storedFreshnessExpiresAt: String(snapshot.freshnessExpiresAt) }
      : {}),
    materializedMembershipKeys: provenance
      .map((row) => String(row.membershipKey ?? ''))
      .filter(Boolean),
    expiredMaterializedRows: provenance.filter((row) => {
      const expiresAt = row.freshnessExpiresAt ? new Date(String(row.freshnessExpiresAt)) : null;
      return (
        Boolean(expiresAt) && !Number.isNaN(expiresAt!.getTime()) && expiresAt!.getTime() < now
      );
    }).length,
  };
}

export async function auditOfficialRosterLane(
  config: OfficialRosterConfig,
  observedAt = new Date(),
): Promise<OfficialRosterLaneEvidence> {
  const stored = await readStoredLaneState(config);
  const base: OfficialRosterLaneEvidence = {
    researchEntityKey: config.researchEntityKey,
    url: config.url,
    configuredSections: [...config.currentSectionLabels],
    reachability: 'UNKNOWN',
    state: 'fetch-error',
    members: [],
    withheldCount: 0,
    duplicateCount: 0,
    sectionsOnPage: [],
    ...stored,
  };

  // Probe before extracting, so a retired or blocked page reads as unreachable
  // rather than as a roster with nobody on it.
  const probe = await probeSourceLink(config.url);
  const health = classifySourceLinkHealth(probe);
  base.reachability = health.healthStatus;
  if (health.httpStatusCode !== undefined) base.httpStatusCode = health.httpStatusCode;
  if (probe.finalUrl && probe.finalUrl !== config.url) base.landedUrl = probe.finalUrl;

  try {
    const page = await fetchPageWithPolicy(config.url);
    if (page.url && page.url !== config.url) base.landedUrl = page.url;
    const roster = extractOfficialResearchHomeRoster(page.html, config, observedAt);
    base.state = roster.state;
    base.members = roster.members.map((member) => ({
      name: member.name,
      title: member.title,
      role: member.role,
      sectionLabel: member.sectionLabel,
      profileUrl: member.profileUrl,
      identityKey: member.identityKey,
      membershipKey: member.membershipKey,
    }));
    base.withheldCount = roster.withheldCount;
    base.duplicateCount = roster.duplicateCount;
    base.sectionsOnPage = sectionLabelsOnPage(page.html);
    if (roster.sourcePublishedAt) {
      base.sourcePublishedAt = roster.sourcePublishedAt.toISOString();
      const ageDays = (observedAt.getTime() - roster.sourcePublishedAt.getTime()) / DAY_MS;
      base.publishAgeDays = Math.round(ageDays * 10) / 10;
      base.daysUntilPublishAgeCeiling =
        Math.round((OFFICIAL_ROSTER_MAX_PUBLISH_AGE_DAYS - ageDays) * 10) / 10;
    }
  } catch (error) {
    base.state = 'fetch-error';
    base.error = String(sanitizeLogValue(error));
  }

  return base;
}

async function main(): Promise<void> {
  const options = parseResearchHomeRosterAuditArgs(process.argv.slice(2));
  const configs = selectRosterConfigs(OFFICIAL_ROSTER_CONFIGS, options.only);
  if (configs.length === 0) throw new Error('--only matched no roster config');

  // Indexes are not built on connect elsewhere in the operator scripts either: a
  // read-only audit must not recreate a collection somebody deliberately dropped.
  mongoose.set('autoIndex', false);
  await initializeConnections();
  try {
    const evidence: OfficialRosterLaneEvidence[] = [];
    for (const config of configs) {
      evidence.push(await auditOfficialRosterLane(config));
    }
    const report = summarizeResearchHomeRosterAudit(evidence, {
      sampledPrecisionReviewedBy: options.sampledPrecisionReviewedBy,
      sampleLimit: options.sampleLimit,
    });
    const { sample, ...withoutSample } = report;
    console.log(
      JSON.stringify({ mode: 'audit', strict: options.strict, ...withoutSample }, null, 2),
    );
    if (options.output) {
      fs.mkdirSync(path.dirname(options.output), { recursive: true });
      fs.writeFileSync(
        options.output,
        `${JSON.stringify({ mode: 'audit', strict: options.strict, ...report }, null, 2)}\n`,
        { mode: 0o600 },
      );
      console.log(`\nReport written to ${options.output}`);
    } else if (sample && sample.length > 0) {
      console.log(
        `\n${sample.length} sample row(s) withheld from stdout; pass --output to read them.`,
      );
    }

    if (options.strict && !report.broadEnablementReady) {
      console.error(
        report.brokenLanes > 0
          ? `--strict: ${report.brokenLanes} lane(s) carry a structural defect.`
          : '--strict: structure is clean but no sampled precision review is recorded; pass --sampled-precision-reviewed-by.',
      );
      process.exitCode = RESEARCH_HOME_ROSTER_AUDIT_ALARM_EXIT_CODE;
    } else if (report.status === 'findings') {
      process.exitCode = RESEARCH_HOME_ROSTER_AUDIT_ALARM_EXIT_CODE;
    }
  } finally {
    await mongoose.disconnect();
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });
  main().catch((error) => {
    console.error('Failed to audit research-home rosters:', sanitizeLogValue(error));
    process.exitCode = 1;
  });
}
