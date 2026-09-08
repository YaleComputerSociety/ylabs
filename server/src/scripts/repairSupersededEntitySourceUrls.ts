import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { ResearchEntity } from '../models/researchEntity';
import { Signal } from '../models/signal';
import { getResearchEntityRosterByEntityId } from '../services/researchEntityMembershipAccessor';
import { checkSourceLinkHealth, type SourceLinkHealth } from '../services/sourceLinkHealth';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  isDecisivelyDeadProbe,
  isDecisivelyLiveProbe,
  isRetryableProbe,
  probeRetryDelayMs,
  storedHealthStatusFor,
} from './verifyOfficialProfileLinksCore';
import {
  entitySourceUrlRepairTargets,
  entitySourceUrlReplacementCandidates,
  isRepointableSignalCitation,
  rewriteSourceUrl,
  summarizeEntitySourceUrlRepair,
  type EntitySourceUrlRepairRow,
  type EntitySourceUrlRepairSummary,
  type EntitySourceUrlRepairTarget,
} from './repairSupersededEntitySourceUrlsCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const DEFAULT_PROBE_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 1500;
const DEFAULT_PACE_DELAY_MS = 400;
const STDOUT_ROW_SAMPLE_LIMIT = 25;
const IDENTIFIED_LEAD_ROLES = new Set(['pi', 'co-pi', 'director', 'co-director']);

export interface RepairSupersededEntitySourceUrlsOptions {
  apply: boolean;
  confirm: boolean;
  limit: number;
  explicitLimit: boolean;
  host?: string;
  slug?: string;
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

function parseValue(value: string | undefined, flag: string): string {
  const parsed = value?.trim();
  if (!parsed || parsed.startsWith('--')) throw new Error(`${flag} requires a value`);
  return parsed;
}

export function parseRepairSupersededEntitySourceUrlsArgs(
  argv: string[],
): RepairSupersededEntitySourceUrlsOptions {
  const options: RepairSupersededEntitySourceUrlsOptions = {
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
    else if (arg === '--confirm-entity-source-url-repair') options.confirm = true;
    else if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInt(arg.slice('--limit='.length));
      options.explicitLimit = true;
    } else if (arg === '--limit') {
      options.limit = parsePositiveInt(argv[i + 1]);
      options.explicitLimit = true;
      i += 1;
    } else if (arg.startsWith('--host=')) {
      options.host = parseValue(arg.slice('--host='.length), '--host').toLowerCase();
    } else if (arg === '--host') {
      options.host = parseValue(argv[i + 1], '--host').toLowerCase();
      i += 1;
    } else if (arg.startsWith('--slug=')) {
      options.slug = parseValue(arg.slice('--slug='.length), '--slug');
    } else if (arg === '--slug') {
      options.slug = parseValue(argv[i + 1], '--slug');
      i += 1;
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown repair-superseded-entity-source-urls argument: ${arg}`);
    }
  }
  return options;
}

export function assertRepairSupersededEntitySourceUrlsApplyAllowed(
  options: Pick<RepairSupersededEntitySourceUrlsOptions, 'apply' | 'confirm' | 'explicitLimit'>,
): void {
  if (!options.apply) return;
  if (!options.confirm) {
    throw new Error('Apply mode requires --confirm-entity-source-url-repair.');
  }
  if (!options.explicitLimit) {
    throw new Error('Apply mode requires an explicit --limit.');
  }
}

export interface RepairSupersededEntitySourceUrlsResult extends EntitySourceUrlRepairSummary {
  mode: 'dry-run' | 'apply';
  citationsRewritten: number;
  signalCitationsRepointed: number;
  rows: EntitySourceUrlRepairRow[];
}

interface EntityCandidate {
  _id: unknown;
  slug?: string;
  name?: string;
  displayName?: string;
  sourceUrls?: unknown;
  sourceLinkHealth?: unknown;
}

/**
 * Display names of each entity's current PI/director leads, resolved in one batch
 * query rather than per entity. A `HISTORICAL` entry is excluded because a departed
 * lead's page is not evidence about who this entity's citation belongs to,
 * mirroring the access materializer's own lead selection.
 */
async function leadDisplayNamesByEntityId(
  entityIds: readonly unknown[],
): Promise<Map<string, string[]>> {
  const rosterByEntityId = await getResearchEntityRosterByEntityId([...entityIds]);
  const leadNames = new Map<string, string[]>();
  for (const [entityId, roster] of rosterByEntityId) {
    leadNames.set(
      entityId,
      roster
        .filter(
          (entry) =>
            entry.state !== 'HISTORICAL' &&
            IDENTIFIED_LEAD_ROLES.has(String(entry.role || '').toLowerCase()),
        )
        .map((entry) => (typeof entry.name === 'string' ? entry.name.trim() : ''))
        .filter(Boolean),
    );
  }
  return leadNames;
}

/**
 * `sourceLinkHealth` with one url's entry replaced, so a repaired citation does not
 * keep the dead entry that made the client badge it "may be unavailable". Dropping
 * the stale entry rather than leaving it is what makes the repair visible: the
 * badge reads recorded health, not the URL.
 */
export function rewriteSourceLinkHealth(
  sourceLinkHealth: unknown,
  before: string,
  after: string,
  health: SourceLinkHealth,
): Array<Record<string, unknown>> {
  const entries = Array.isArray(sourceLinkHealth)
    ? (sourceLinkHealth as Array<Record<string, unknown>>)
    : [];
  const kept = entries.filter((entry) => entry?.url !== before && entry?.url !== after);
  return [
    ...kept,
    {
      url: after,
      healthStatus: storedHealthStatusFor(health),
      ...(typeof health.httpStatusCode === 'number'
        ? { httpStatusCode: health.httpStatusCode }
        : {}),
      checkedAt: new Date(),
    },
  ];
}

export async function runRepairSupersededEntitySourceUrls(options: {
  apply: boolean;
  limit?: number;
  host?: string;
  slug?: string;
  probe?: (url: string) => Promise<SourceLinkHealth>;
  sleep?: (ms: number) => Promise<unknown>;
  retries?: number;
  retryDelayMs?: number;
  paceDelayMs?: number;
}): Promise<RepairSupersededEntitySourceUrlsResult> {
  const probe = options.probe ?? checkSourceLinkHealth;
  const sleep = options.sleep ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)));
  const retries = options.retries ?? DEFAULT_PROBE_RETRIES;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const paceDelayMs = options.paceDelayMs ?? DEFAULT_PACE_DELAY_MS;

  const probeWithBackoff = async (url: string): Promise<SourceLinkHealth> => {
    let health = await probe(url);
    for (let attempt = 1; attempt <= retries && isRetryableProbe(health); attempt += 1) {
      await sleep(probeRetryDelayMs(attempt, retryDelayMs));
      health = await probe(url);
    }
    return health;
  };

  const entities = (await ResearchEntity.find({
    archived: { $ne: true },
    sourceUrls: { $exists: true, $ne: [] },
    ...(options.slug ? { slug: options.slug } : {}),
  })
    .select('_id slug name displayName sourceUrls sourceLinkHealth')
    .lean()) as unknown as EntityCandidate[];

  const leadNamesByEntityId = await leadDisplayNamesByEntityId(
    entities.map((entity) => entity._id),
  );

  const targets: EntitySourceUrlRepairTarget[] = [];
  const entityById = new Map<string, EntityCandidate>();
  for (const entity of entities) {
    const entityId = String(entity._id);
    entityById.set(entityId, entity);
    const leadDisplayNames = leadNamesByEntityId.get(entityId) || [];
    for (const target of entitySourceUrlRepairTargets({
      id: entityId,
      slug: entity.slug,
      name: entity.name,
      displayName: entity.displayName,
      sourceUrls: entity.sourceUrls,
      leadDisplayNames,
    })) {
      if (options.host && target.host !== options.host) continue;
      targets.push(target);
    }
  }

  const selected = options.limit ? targets.slice(0, options.limit) : targets;
  const rows: EntitySourceUrlRepairRow[] = [];
  let citationsRewritten = 0;
  let signalCitationsRepointed = 0;

  for (const target of selected) {
    const health = await probeWithBackoff(target.url);
    const row: EntitySourceUrlRepairRow = {
      entityId: target.entityId,
      slug: target.slug,
      host: target.host,
      before: target.url,
      verdict: 'inconclusive',
      httpStatusCode: health.httpStatusCode,
    };

    if (isDecisivelyLiveProbe(health)) {
      row.verdict = 'healthy';
      rows.push(row);
      continue;
    }
    if (!isDecisivelyDeadProbe(health)) {
      rows.push(row);
      continue;
    }

    row.verdict = 'dead';
    let replacementHealth: SourceLinkHealth | undefined;
    for (const candidate of entitySourceUrlReplacementCandidates(target)) {
      if (paceDelayMs > 0) await sleep(paceDelayMs);
      const candidateHealth = await probeWithBackoff(candidate);
      if (!isDecisivelyLiveProbe(candidateHealth)) continue;
      row.verdict = 'repaired';
      row.after = candidate;
      replacementHealth = candidateHealth;
      break;
    }
    rows.push(row);

    if (!options.apply || row.verdict !== 'repaired' || !row.after || !replacementHealth) continue;

    const entity = entityById.get(target.entityId);
    const rewritten = rewriteSourceUrl(
      Array.isArray(entity?.sourceUrls) ? (entity?.sourceUrls as unknown[]) : [],
      row.before,
      row.after,
    );
    const entityResult = await ResearchEntity.updateOne(
      { _id: target.entityId },
      {
        $set: {
          sourceUrls: rewritten,
          sourceLinkHealth: rewriteSourceLinkHealth(
            entity?.sourceLinkHealth,
            row.before,
            row.after,
            replacementHealth,
          ),
        },
      },
    );
    citationsRewritten += entityResult.modifiedCount || 0;
    if (entity) entity.sourceUrls = rewritten;

    const signals = await Signal.find({
      researchEntityId: target.entityId,
      'source.url': row.before,
    })
      .select('_id derivationKey')
      .lean();
    for (const signal of signals) {
      if (!isRepointableSignalCitation((signal as { derivationKey?: unknown }).derivationKey)) {
        continue;
      }
      const signalResult = await Signal.updateOne(
        { _id: (signal as { _id: unknown })._id },
        { $set: { 'source.url': row.after } },
      );
      signalCitationsRepointed += signalResult.modifiedCount || 0;
    }
  }

  return {
    ...summarizeEntitySourceUrlRepair(entities.length, rows),
    mode: options.apply ? 'apply' : 'dry-run',
    citationsRewritten,
    signalCitationsRepointed,
    rows,
  };
}

/**
 * The planned rewrites are the operator's only guard against a mis-targeted apply,
 * so a sample goes to stdout rather than only to `--output`. Before/after URLs are
 * already public department pages; person display names stay out of the console.
 */
export function stdoutReport(
  result: RepairSupersededEntitySourceUrlsResult,
): Record<string, unknown> {
  const repaired = result.rows.filter((row) => row.verdict === 'repaired');
  const sample = repaired.slice(0, STDOUT_ROW_SAMPLE_LIMIT);
  return {
    entitiesConsidered: result.entitiesConsidered,
    citationsProbed: result.citationsProbed,
    healthy: result.healthy,
    repaired: result.repaired,
    dead: result.dead,
    inconclusive: result.inconclusive,
    mode: result.mode,
    citationsRewritten: result.citationsRewritten,
    signalCitationsRepointed: result.signalCitationsRepointed,
    rowsOmittedFromSample: repaired.length - sample.length,
    rows: sample.map((row) => ({
      slug: row.slug,
      before: row.before,
      after: row.after,
      httpStatusCode: row.httpStatusCode,
    })),
  };
}

async function main(): Promise<void> {
  const options = parseRepairSupersededEntitySourceUrlsArgs(process.argv.slice(2));
  assertRepairSupersededEntitySourceUrlsApplyAllowed(options);

  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'repair:superseded-entity-source-urls',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${
      options.apply ? 'apply' : 'dry-run'
    }`,
  );

  await mongoose.connect(process.env.MONGODBURL as string);
  try {
    const result = await runRepairSupersededEntitySourceUrls({
      apply: options.apply,
      limit: options.explicitLimit ? options.limit : undefined,
      host: options.host,
      slug: options.slug,
    });
    const payload = {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      options: {
        apply: options.apply,
        limit: options.explicitLimit ? options.limit : undefined,
        host: options.host,
        slug: options.slug,
      },
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
