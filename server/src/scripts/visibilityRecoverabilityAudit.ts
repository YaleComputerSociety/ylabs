/**
 * Read-only audit: how much of the withheld corpus can the engine actually promote?
 *
 * Usage:
 *   yarn visibility:recoverability
 *   yarn visibility:recoverability --tier=operator_review --limit=500
 *   yarn visibility:recoverability --tier=operator_review --tier=suppressed
 *   yarn visibility:recoverability --output=/tmp/recoverability.json
 *
 * `--tier` may be repeated and accepts only withheld tiers. See
 * visibilityRecoverabilityAuditCore.ts for what the four buckets mean and why a record
 * is classified by its WORST blocker rather than its best.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { isBlockingVisibilityReason } from '../services/studentVisibilityGateService';
import { isDisallowedResearchEntitySourceUrl } from '../utils/researchHomeWebsiteUrl';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { serializedDocumentId } from '../utils/idSerialization';
import {
  BLOCKER_EVIDENCE_FIELDS,
  buildRecoverabilityReport,
  classifyRecoverability,
  type RecoverabilityInputRecord,
} from './visibilityRecoverabilityAuditCore';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const WITHHELD_TIERS = ['operator_review', 'suppressed'] as const;
type WithheldTier = (typeof WITHHELD_TIERS)[number];

interface Args {
  tiers: WithheldTier[];
  limit?: number;
  output?: string;
  examples: number;
}

export function parseArgs(argv: string[]): Args {
  const requestedTiers: WithheldTier[] = [];
  const args: Args = { tiers: [...WITHHELD_TIERS], examples: 5 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith('--tier=')) requestedTiers.push(withheldTier(arg.slice('--tier='.length)));
    else if (arg.startsWith('--limit=')) args.limit = positiveInt(arg.slice('--limit='.length));
    else if (arg.startsWith('--examples='))
      args.examples = positiveInt(arg.slice('--examples='.length));
    else if (arg.startsWith('--output='))
      args.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (requestedTiers.length > 0) args.tiers = [...new Set(requestedTiers)];
  return args;
}

// An unvalidated tier would let `--tier=student_ready` audit PUBLIC rows under a
// "withheld records scanned" heading, and a typo would print a clean zero that reads
// as a real measurement. Both are worse than a crash for a measurement instrument.
function withheldTier(value: string): WithheldTier {
  if (!(WITHHELD_TIERS as readonly string[]).includes(value))
    throw new Error(`--tier must be one of ${WITHHELD_TIERS.join(', ')}, got ${value}`);
  return value as WithheldTier;
}

function positiveInt(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error(`expected a positive integer, got ${value}`);
  return parsed;
}

/**
 * Every entity field a BLOCKING blocker reads, so one projection covers them all. Soft
 * enrichment reasons are excluded because they never gate and are filtered out of
 * `blockers` below, so projecting their fields would widen every read for no effect.
 */
const EVIDENCE_FIELDS = [
  ...new Set(
    Object.entries(BLOCKER_EVIDENCE_FIELDS)
      .filter(([reason]) => isBlockingVisibilityReason(reason))
      .flatMap(([, fields]) => fields),
  ),
];

/** The fields the canonical `hasSourceUrl` check reads, so citability matches the gate. */
const SOURCE_URL_FIELDS = ['sourceUrls', 'websiteUrl', 'website'];

const OBSERVATION_CHUNK_SIZE = 400;

const hasUsableValue = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return value !== null && value !== undefined;
};

/**
 * Every URL an acquisition lane could still crawl. Reads the same three fields as the
 * canonical `hasSourceUrl` (researchEntityQuality.ts): a bare `sourceUrls` is a known
 * projection gap, so a row with only a `websiteUrl` still has a page to fetch and must
 * not be counted against the promotion ceiling.
 */
const citableSourceUrlsFor = (record: Record<string, unknown>): string[] => [
  ...new Set(
    SOURCE_URL_FIELDS.flatMap((field) => {
      const value = record[field];
      return Array.isArray(value) ? value : [value];
    })
      .filter((url): url is string => typeof url === 'string' && /^https?:\/\//i.test(url.trim()))
      .map((url) => url.trim())
      .filter((url) => !isDisallowedResearchEntitySourceUrl(url)),
  ),
];

const chunked = <T>(values: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size)
    chunks.push(values.slice(index, index + size));
  return chunks;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await initializeConnections();
  const dbLabel = mongoose.connection.name;

  const query = { archived: { $ne: true }, studentVisibilityTier: { $in: args.tiers } };
  // Sorted so a `--limit` run samples the same rows every time; an instrument whose
  // numbers are compared across runs cannot take whatever order the engine returns.
  let cursor = ResearchEntity.find(query)
    .select(
      `_id slug studentVisibilityTier studentVisibilityReasons studentVisibilityComputedAt ${SOURCE_URL_FIELDS.join(' ')} ${EVIDENCE_FIELDS.join(' ')}`,
    )
    .sort({ _id: 1 });
  if (args.limit) cursor = cursor.limit(args.limit);
  const entities = await cursor.lean();

  const recordIds = entities.map(
    (entity) => serializedDocumentId((entity as { _id: unknown })._id) || '',
  );

  const slugToId = new Map(
    entities.map((entity) => [
      String((entity as { slug?: unknown }).slug || ''),
      serializedDocumentId((entity as { _id: unknown })._id) || '',
    ]),
  );

  // Live observations for the scoped records, read in chunks so peak memory stays
  // bounded on the full withheld corpus rather than scaling with it. A rolled-back or
  // superseded observation is NOT evidence: it is exactly what a prior repair retired,
  // and counting it would report retired grafts as recoverable value.
  const observed = new Map<string, Set<string>>();
  for (const chunk of chunked(entities, OBSERVATION_CHUNK_SIZE)) {
    const observations = await Observation.find({
      entityType: 'researchEntity',
      field: { $in: EVIDENCE_FIELDS },
      superseded: { $ne: true },
      'rollback.rolledBackAt': { $exists: false },
      $or: [
        { entityId: { $in: chunk.map((e) => (e as { _id: unknown })._id) } },
        { entityKey: { $in: chunk.map((e) => String((e as { slug?: unknown }).slug || '')) } },
      ],
    })
      .select('entityId entityKey field value')
      .lean();

    for (const observation of observations as Record<string, unknown>[]) {
      if (!hasUsableValue(observation.value)) continue;
      const key =
        (observation.entityId ? serializedDocumentId(observation.entityId) : '') ||
        slugToId.get(String(observation.entityKey || '')) ||
        '';
      if (!key) continue;
      const set = observed.get(key) || new Set<string>();
      set.add(String(observation.field));
      observed.set(key, set);
    }
  }

  const blockersByRecord = new Map<string, string[]>();
  const inputs: RecoverabilityInputRecord[] = entities.map((entity) => {
    const record = entity as Record<string, unknown>;
    const recordId = serializedDocumentId(record._id) || '';
    const reasons = (record.studentVisibilityReasons as string[]) || [];
    const blockers = reasons.filter((reason) => isBlockingVisibilityReason(reason));
    blockersByRecord.set(recordId, blockers);
    const populatedFields = new Set(
      EVIDENCE_FIELDS.filter((field) => hasUsableValue(record[field])),
    );
    return {
      recordId,
      slug: String(record.slug || ''),
      blockers,
      gated: Boolean(record.studentVisibilityComputedAt) || reasons.length > 0,
      populatedFields,
      observedFields: observed.get(recordId) || new Set<string>(),
      citableSourceUrls: citableSourceUrlsFor(record),
    };
  });

  const verdicts = inputs.map(classifyRecoverability);
  const report = buildRecoverabilityReport(verdicts, blockersByRecord);

  const examplesByBucket = Object.fromEntries(
    (['regate', 'materialize', 'acquire', 'ceiling'] as const).map((bucket) => [
      bucket,
      verdicts
        .filter((verdict) => verdict.bucket === bucket)
        .slice(0, args.examples)
        .map((verdict) => ({ slug: verdict.slug, decidingBlocker: verdict.decidingBlocker })),
    ]),
  );

  const payload = {
    generatedAt: new Date().toISOString(),
    db: dbLabel,
    tiers: args.tiers,
    scanned: recordIds.length,
    ...report,
    examplesByBucket,
  };

  console.log(
    `\nWithheld records scanned: ${report.withheld}  (db ${dbLabel}, tiers ${args.tiers.join(',')})\n`,
  );
  console.log(
    `  REGATE       ${String(report.byBucket.regate).padStart(5)}   gate never ran; resolving mostly reveals a real blocker, not a promotion`,
  );
  console.log(
    `  MATERIALIZE  ${String(report.byBucket.materialize).padStart(5)}   evidence is stored, document lacks it -> repair-queue territory`,
  );
  console.log(
    `  ACQUIRE      ${String(report.byBucket.acquire).padStart(5)}   no observation, but a citable source remains -> crawl + extract`,
  );
  console.log(
    `  CEILING      ${String(report.byBucket.ceiling).padStart(5)}   decision blocker, unmodelled hold, or no evidence and no source -> not promotable`,
  );
  console.log(
    `               ${String(report.decisionOnlyRows).padStart(5)}   of those carry only decision blockers -> no lane could ever move them\n`,
  );
  console.log('  blocker                                rows  materialize  acquire  ceiling');
  for (const row of report.byBlocker) {
    console.log(
      `  ${row.blocker.padEnd(36)} ${String(row.rows).padStart(5)} ${String(row.materialize).padStart(12)} ${String(row.acquire).padStart(8)} ${String(row.ceiling).padStart(8)}`,
    );
  }
  console.log('');

  if (args.output) {
    const fs = await import('fs');
    fs.writeFileSync(args.output, JSON.stringify(payload, null, 2));
    console.log(`report written to ${args.output}\n`);
  }

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error('visibility recoverability audit failed:', sanitizeLogValue(error));
  process.exit(1);
});
