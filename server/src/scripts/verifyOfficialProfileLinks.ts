import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { Researcher, type ResearcherProfileLink } from '../models/researcher';
import { checkSourceLinkHealth, type SourceLinkHealth } from '../services/sourceLinkHealth';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { isYaleOfficialProfileUrl } from './backfillResearcherOfficialProfileLinksCore';
import { materializationReadScopeFilter } from '../scrapers/entityMaterializer';
import {
  isDecisivelyDeadProbe,
  isDecisivelyLiveProbe,
  officialProfileLinkCandidates,
  officialProfileLinkHost,
  settledHealthStatusFor,
  summarizeDepartmentLinkHealth,
  type DepartmentLinkHealthSummary,
  type OfficialProfileLinkRow,
} from './verifyOfficialProfileLinksCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const DEFAULT_HOST_CONCURRENCY = 4;

export interface VerifyOfficialProfileLinksOptions {
  apply: boolean;
  confirm: boolean;
  limit: number;
  explicitLimit: boolean;
  host?: string;
  hostConcurrency: number;
  output?: string;
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  if (!value || value.startsWith('--') || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

function parseHost(value: string | undefined): string {
  const host = value?.trim().toLowerCase();
  if (!host || host.startsWith('--') || !/^[a-z0-9.-]+\.yale\.edu$/.test(host)) {
    throw new Error('--host must be a yale.edu department host');
  }
  return host;
}

export function parseVerifyOfficialProfileLinksArgs(
  argv: string[],
): VerifyOfficialProfileLinksOptions {
  const options: VerifyOfficialProfileLinksOptions = {
    apply: false,
    confirm: false,
    limit: 0,
    explicitLimit: false,
    hostConcurrency: DEFAULT_HOST_CONCURRENCY,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === '--confirm-profile-link-verification') options.confirm = true;
    else if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInt(arg.slice('--limit='.length), '--limit');
      options.explicitLimit = true;
    } else if (arg === '--limit') {
      options.limit = parsePositiveInt(argv[i + 1], '--limit');
      options.explicitLimit = true;
      i += 1;
    } else if (arg.startsWith('--host=')) {
      options.host = parseHost(arg.slice('--host='.length));
    } else if (arg === '--host') {
      options.host = parseHost(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--host-concurrency=')) {
      options.hostConcurrency = parsePositiveInt(
        arg.slice('--host-concurrency='.length),
        '--host-concurrency',
      );
    } else if (arg === '--host-concurrency') {
      options.hostConcurrency = parsePositiveInt(argv[i + 1], '--host-concurrency');
      i += 1;
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown verify-official-profile-links argument: ${arg}`);
    }
  }
  return options;
}

export function assertVerifyOfficialProfileLinksApplyAllowed(
  options: Pick<VerifyOfficialProfileLinksOptions, 'apply' | 'confirm' | 'explicitLimit'>,
): void {
  if (!options.apply) return;
  if (!options.confirm) {
    throw new Error('Apply mode requires --confirm-profile-link-verification.');
  }
  if (!options.explicitLimit) {
    throw new Error('Apply mode requires an explicit --limit.');
  }
}

export interface VerifyOfficialProfileLinksResult {
  mode: 'dry-run' | 'apply';
  probed: number;
  healthy: number;
  repaired: number;
  dead: number;
  inconclusive: number;
  statusesWritten: number;
  urlsRepaired: number;
  departments: DepartmentLinkHealthSummary[];
  rows: OfficialProfileLinkRow[];
}

interface OfficialLinkTarget {
  researcherId: string;
  displayName?: string;
  host: string;
  url: string;
  storedHealthStatus?: string;
}

/**
 * Read scope matters here as much as it does in the materializer: a superseded or
 * rollback-retired observation is no longer evidence that the site publishes that
 * page, so honouring it would license a replacement built on retracted evidence.
 */
const observedProfileUrlsByHost = async (): Promise<Map<string, string[]>> => {
  const index = new Map<string, string[]>();
  const cursor = Observation.find({
    entityType: 'user',
    field: 'profileUrls',
    ...materializationReadScopeFilter(),
  })
    .select('value')
    .lean()
    .cursor();
  for await (const observation of cursor) {
    const value = (observation as { value?: unknown }).value;
    if (!value || typeof value !== 'object') continue;
    for (const candidate of Object.values(value as Record<string, unknown>)) {
      if (!isYaleOfficialProfileUrl(candidate)) continue;
      const url = String(candidate).trim();
      const host = officialProfileLinkHost(url);
      if (!host) continue;
      const bucket = index.get(host);
      if (bucket) {
        if (!bucket.includes(url)) bucket.push(url);
      } else {
        index.set(host, [url]);
      }
    }
  }
  return index;
};

const officialLinkTargets = async (host?: string): Promise<OfficialLinkTarget[]> => {
  const researchers = await Researcher.find({
    archived: { $ne: true },
    profileLinks: { $elemMatch: { kind: 'YALE_OFFICIAL' } },
  })
    .select('_id displayName profileLinks')
    .lean();

  const targets: OfficialLinkTarget[] = [];
  for (const researcher of researchers) {
    const links = (researcher as { profileLinks?: ResearcherProfileLink[] }).profileLinks || [];
    for (const link of links) {
      if (link?.kind !== 'YALE_OFFICIAL') continue;
      const linkHost = officialProfileLinkHost(link.url);
      if (!linkHost) continue;
      if (host && linkHost !== host) continue;
      targets.push({
        researcherId: String(researcher._id),
        displayName: (researcher as { displayName?: string }).displayName,
        host: linkHost,
        url: String(link.url).trim(),
        storedHealthStatus: link.healthStatus,
      });
    }
  }
  return targets;
};

export async function runVerifyOfficialProfileLinks(
  options: Pick<VerifyOfficialProfileLinksOptions, 'apply' | 'host' | 'hostConcurrency'> & {
    limit?: number;
    probe?: (url: string) => Promise<SourceLinkHealth>;
    onHostVerified?: (host: string, links: number) => void;
  },
): Promise<VerifyOfficialProfileLinksResult> {
  const probe = options.probe ?? checkSourceLinkHealth;
  const observedIndex = await observedProfileUrlsByHost();
  const allTargets = await officialLinkTargets(options.host);
  const targets = options.limit ? allTargets.slice(0, options.limit) : allTargets;

  const byHost = new Map<string, OfficialLinkTarget[]>();
  for (const target of targets) {
    const bucket = byHost.get(target.host);
    if (bucket) bucket.push(target);
    else byHost.set(target.host, [target]);
  }

  const rows: OfficialProfileLinkRow[] = [];
  let statusesWritten = 0;
  let urlsRepaired = 0;

  const verifyTarget = async (target: OfficialLinkTarget): Promise<void> => {
    const health = await probe(target.url);
    let verdict: OfficialProfileLinkRow['verdict'] = 'inconclusive';
    let replacementUrl: string | undefined;

    if (isDecisivelyLiveProbe(health)) {
      verdict = 'healthy';
    } else if (isDecisivelyDeadProbe(health)) {
      verdict = 'dead';
      const observed = observedIndex.get(target.host) || [];
      const candidates = officialProfileLinkCandidates(target.url, target.displayName, observed);
      for (const candidate of candidates) {
        if (isDecisivelyLiveProbe(await probe(candidate))) {
          verdict = 'repaired';
          replacementUrl = candidate;
          break;
        }
      }
    }

    rows.push({
      researcherId: target.researcherId,
      displayName: target.displayName,
      host: target.host,
      url: target.url,
      verdict,
      httpStatusCode: health.httpStatusCode,
      replacementUrl,
    });

    if (!options.apply) return;

    const settledStatus = settledHealthStatusFor(health);
    const update: Record<string, unknown> = {
      'profileLinks.$[link].verifiedAt': new Date(),
    };
    if (replacementUrl) {
      update['profileLinks.$[link].url'] = replacementUrl;
      update['profileLinks.$[link].healthStatus'] = 'HEALTHY';
    } else if (settledStatus) {
      update['profileLinks.$[link].healthStatus'] = settledStatus;
    }
    const result = await Researcher.updateOne(
      { _id: target.researcherId },
      { $set: update },
      { arrayFilters: [{ 'link.kind': 'YALE_OFFICIAL', 'link.url': target.url }] },
    );
    if (result.modifiedCount) {
      statusesWritten += 1;
      if (replacementUrl) urlsRepaired += 1;
    }
  };

  const hosts = [...byHost.values()];
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < hosts.length) {
      const bucket = hosts[cursor];
      cursor += 1;
      for (const target of bucket) await verifyTarget(target);
      options.onHostVerified?.(bucket[0].host, bucket.length);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(options.hostConcurrency, hosts.length || 1) }, worker),
  );

  const countOf = (verdict: OfficialProfileLinkRow['verdict']) =>
    rows.filter((row) => row.verdict === verdict).length;

  return {
    mode: options.apply ? 'apply' : 'dry-run',
    probed: rows.length,
    healthy: countOf('healthy'),
    repaired: countOf('repaired'),
    dead: countOf('dead'),
    inconclusive: countOf('inconclusive'),
    statusesWritten,
    urlsRepaired,
    departments: summarizeDepartmentLinkHealth(rows),
    rows,
  };
}

async function main(): Promise<void> {
  const options = parseVerifyOfficialProfileLinksArgs(process.argv.slice(2));
  assertVerifyOfficialProfileLinksApplyAllowed(options);

  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'researchers:verify-official-profile-links',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${
      options.apply ? 'apply' : 'dry-run'
    }`,
  );

  await mongoose.connect(process.env.MONGODBURL as string);
  try {
    const result = await runVerifyOfficialProfileLinks({
      apply: options.apply,
      host: options.host,
      hostConcurrency: options.hostConcurrency,
      limit: options.explicitLimit ? options.limit : undefined,
      onHostVerified: (host, links) => console.log(`verified ${host} (${links} links)`),
    });
    const payload = {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      options: {
        apply: options.apply,
        host: options.host,
        hostConcurrency: options.hostConcurrency,
        limit: options.explicitLimit ? options.limit : undefined,
      },
      result,
    };
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(safeOutput, `${JSON.stringify(payload, null, 2)}\n`);
      console.log(`Saved verification report to ${safeOutput}`);
    }
    console.log(JSON.stringify({ ...result, rows: result.rows.length }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}
