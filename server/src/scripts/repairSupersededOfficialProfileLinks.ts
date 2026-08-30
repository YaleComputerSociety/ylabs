import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { Account } from '../models/account';
import { Observation } from '../models/observation';
import { Researcher } from '../models/researcher';
import { materializationReadScopeFilter } from '../scrapers/entityMaterializer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  canonicalOfficialProfileUrlKey,
  officialProfileEvidenceKey,
  planSupersededOfficialProfileLinkRepair,
  summarizeSupersededOfficialProfileLinkRepair,
  type SupersededOfficialProfileLinkPlanRow,
  type SupersededOfficialProfileLinkSummary,
} from './repairSupersededOfficialProfileLinksCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface RepairSupersededOfficialProfileLinksOptions {
  apply: boolean;
  confirm: boolean;
  limit: number;
  explicitLimit: boolean;
  output?: string;
}

function parsePositiveInt(value: string | undefined): number {
  if (!value || value.startsWith('--') || !/^[1-9]\d*$/.test(value)) {
    throw new Error('--limit must be a positive integer');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error('--limit must be a positive integer');
  return parsed;
}

export function parseRepairSupersededOfficialProfileLinksArgs(
  argv: string[],
): RepairSupersededOfficialProfileLinksOptions {
  const options: RepairSupersededOfficialProfileLinksOptions = {
    apply: false,
    confirm: false,
    limit: 0,
    explicitLimit: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === '--confirm-superseded-profile-link-repair') options.confirm = true;
    else if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInt(arg.slice('--limit='.length));
      options.explicitLimit = true;
    } else if (arg === '--limit') {
      options.limit = parsePositiveInt(argv[i + 1]);
      options.explicitLimit = true;
      i += 1;
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown repair-superseded-official-profile-links argument: ${arg}`);
    }
  }
  return options;
}

export function assertRepairSupersededOfficialProfileLinksApplyAllowed(
  options: Pick<RepairSupersededOfficialProfileLinksOptions, 'apply' | 'confirm' | 'explicitLimit'>,
): void {
  if (!options.apply) return;
  if (!options.confirm) {
    throw new Error('Apply mode requires --confirm-superseded-profile-link-repair.');
  }
  if (!options.explicitLimit) {
    throw new Error('Apply mode requires an explicit --limit.');
  }
}

export interface RepairSupersededOfficialProfileLinksResult extends SupersededOfficialProfileLinkSummary {
  mode: 'dry-run' | 'apply';
  updated: number;
  rows: SupersededOfficialProfileLinkPlanRow[];
}

interface ObservedProfileUrl {
  url: string;
  observedAt: number;
}

/**
 * Read scope matters here as much as it does in the materializer: a superseded or
 * rollback-retired observation is no longer evidence that the site publishes that
 * page, so honouring it would install a fresh dead link.
 */
async function observedOfficialProfileUrlsByEvidenceKey(): Promise<Map<string, string[]>> {
  const observedByEvidenceKey = new Map<string, Map<string, ObservedProfileUrl>>();
  const cursor = Observation.find({
    entityType: 'user',
    field: 'profileUrls',
    ...materializationReadScopeFilter(),
  })
    .select('entityKey value observedAt')
    .lean()
    .cursor();
  for await (const observation of cursor) {
    const row = observation as { entityKey?: unknown; value?: unknown; observedAt?: unknown };
    const evidenceKey = officialProfileEvidenceKey(row.entityKey);
    if (!evidenceKey) continue;
    if (!row.value || typeof row.value !== 'object') continue;
    const observedAt = row.observedAt instanceof Date ? row.observedAt.getTime() : 0;
    const observedForKey =
      observedByEvidenceKey.get(evidenceKey) || new Map<string, ObservedProfileUrl>();
    for (const candidate of Object.values(row.value as Record<string, unknown>)) {
      const canonicalKey = canonicalOfficialProfileUrlKey(candidate);
      if (!canonicalKey) continue;
      const known = observedForKey.get(canonicalKey);
      if (known && known.observedAt >= observedAt) continue;
      observedForKey.set(canonicalKey, { url: String(candidate).trim(), observedAt });
    }
    observedByEvidenceKey.set(evidenceKey, observedForKey);
  }
  return new Map(
    Array.from(observedByEvidenceKey, ([evidenceKey, observedForKey]) => [
      evidenceKey,
      Array.from(observedForKey.values())
        .sort((left, right) => right.observedAt - left.observedAt)
        .map((observed) => observed.url),
    ]),
  );
}

interface OfficialProfileLinkCandidate {
  _id: unknown;
  displayName?: string;
  profileLinks?: unknown;
  identifiers?: { netid?: string };
  accountId?: unknown;
}

/**
 * Same-slug people exist across Yale sites (#468), so evidence is only ever
 * matched to the researcher it was observed for. A researcher with no netid on
 * either the record or its account is unmatchable and is left alone.
 */
async function evidenceKeyByResearcherId(
  candidates: OfficialProfileLinkCandidate[],
): Promise<Map<string, string>> {
  const evidenceKeys = new Map<string, string>();
  const researcherIdsByAccountId = new Map<string, string[]>();
  for (const candidate of candidates) {
    const researcherId = String(candidate._id);
    const netid = officialProfileEvidenceKey(candidate.identifiers?.netid);
    if (netid) {
      evidenceKeys.set(researcherId, netid);
      continue;
    }
    if (!candidate.accountId) continue;
    const accountId = String(candidate.accountId);
    researcherIdsByAccountId.set(accountId, [
      ...(researcherIdsByAccountId.get(accountId) || []),
      researcherId,
    ]);
  }
  if (researcherIdsByAccountId.size === 0) return evidenceKeys;
  const accounts = await Account.find({
    _id: { $in: Array.from(researcherIdsByAccountId.keys()) },
  })
    .select('_id netid')
    .lean();
  for (const account of accounts) {
    const netid = officialProfileEvidenceKey((account as { netid?: string }).netid);
    if (!netid) continue;
    for (const researcherId of researcherIdsByAccountId.get(String(account._id)) || []) {
      evidenceKeys.set(researcherId, netid);
    }
  }
  return evidenceKeys;
}

export async function runRepairSupersededOfficialProfileLinks(options: {
  apply: boolean;
  limit?: number;
}): Promise<RepairSupersededOfficialProfileLinksResult> {
  const observedByEvidenceKey = await observedOfficialProfileUrlsByEvidenceKey();
  const candidates = (await Researcher.find({
    archived: { $ne: true },
    profileLinks: { $elemMatch: { kind: 'YALE_OFFICIAL' } },
  })
    .select('_id displayName profileLinks identifiers.netid accountId')
    .lean()) as unknown as OfficialProfileLinkCandidate[];
  const evidenceKeys = await evidenceKeyByResearcherId(candidates);

  const rows: SupersededOfficialProfileLinkPlanRow[] = [];
  for (const candidate of candidates) {
    const researcherId = String(candidate._id);
    const evidenceKey = evidenceKeys.get(researcherId);
    const observedUrls = evidenceKey ? observedByEvidenceKey.get(evidenceKey) : undefined;
    if (!observedUrls?.length) continue;
    const row = planSupersededOfficialProfileLinkRepair(
      {
        id: researcherId,
        displayName: candidate.displayName,
        profileLinks: candidate.profileLinks,
      },
      observedUrls,
    );
    if (row) rows.push(row);
  }

  const selected = options.limit ? rows.slice(0, options.limit) : rows;
  let updated = 0;
  if (options.apply) {
    const verifiedAt = new Date();
    for (const row of selected) {
      const result = await Researcher.updateOne(
        { _id: row.id },
        {
          $set: {
            'profileLinks.$[stale].url': row.after,
            'profileLinks.$[stale].verifiedAt': verifiedAt,
            'profileLinks.$[stale].healthStatus': 'UNKNOWN',
          },
        },
        { arrayFilters: [{ 'stale.kind': 'YALE_OFFICIAL', 'stale.url': row.before }] },
      );
      updated += result.modifiedCount || 0;
    }
  }

  return {
    ...summarizeSupersededOfficialProfileLinkRepair(candidates.length, rows),
    mode: options.apply ? 'apply' : 'dry-run',
    updated,
    rows: selected,
  };
}

const STDOUT_ROW_SAMPLE_LIMIT = 25;

/**
 * Reviewing the planned rewrites is the operator's only guard against a
 * mis-targeted apply, so the sample goes to stdout rather than only to `--output`.
 * Display names stay out of the console; the before/after URLs are what a
 * reviewer needs and are already public department pages.
 */
export function stdoutReport(
  result: RepairSupersededOfficialProfileLinksResult,
): Record<string, unknown> {
  const sample = result.rows.slice(0, STDOUT_ROW_SAMPLE_LIMIT);
  return {
    considered: result.considered,
    repairable: result.repairable,
    mode: result.mode,
    updated: result.updated,
    selected: result.rows.length,
    rowsOmittedFromSample: result.rows.length - sample.length,
    rows: sample.map((row) => ({ id: row.id, before: row.before, after: row.after })),
  };
}

async function main(): Promise<void> {
  const options = parseRepairSupersededOfficialProfileLinksArgs(process.argv.slice(2));
  assertRepairSupersededOfficialProfileLinksApplyAllowed(options);

  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'repair:superseded-official-profile-links',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${
      options.apply ? 'apply' : 'dry-run'
    }`,
  );

  await mongoose.connect(process.env.MONGODBURL as string);
  try {
    const result = await runRepairSupersededOfficialProfileLinks({
      apply: options.apply,
      limit: options.explicitLimit ? options.limit : undefined,
    });
    const payload = {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      options: { apply: options.apply, limit: options.explicitLimit ? options.limit : undefined },
      result,
    };
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(safeOutput, `${JSON.stringify(payload, null, 2)}\n`);
      console.log(`Saved repair report to ${safeOutput}`);
    }
    console.log(JSON.stringify(stdoutReport(result), null, 2));
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
