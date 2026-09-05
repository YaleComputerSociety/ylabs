/**
 * Read-only audit: how much of the withheld corpus can the engine actually promote?
 *
 * Usage:
 *   yarn visibility:recoverability
 *   yarn visibility:recoverability --tier=operator_review --limit=500
 *   yarn visibility:recoverability --output=/tmp/recoverability.json
 *
 * See visibilityRecoverabilityAuditCore.ts for what the three buckets mean and why
 * a record is classified by its WORST blocker rather than its best.
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

interface Args {
  tiers: string[];
  limit?: number;
  output?: string;
  examples: number;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { tiers: [...WITHHELD_TIERS], examples: 5 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith('--tier=')) args.tiers = [arg.slice('--tier='.length)];
    else if (arg.startsWith('--limit=')) args.limit = positiveInt(arg.slice('--limit='.length));
    else if (arg.startsWith('--examples='))
      args.examples = positiveInt(arg.slice('--examples='.length));
    else if (arg.startsWith('--output='))
      args.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function positiveInt(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error(`expected a positive integer, got ${value}`);
  return parsed;
}

/** Every entity field any modelled blocker reads, so one projection covers them all. */
const EVIDENCE_FIELDS = [...new Set(Object.values(BLOCKER_EVIDENCE_FIELDS).flat())];

const hasUsableValue = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return value !== null && value !== undefined;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await initializeConnections();
  const dbLabel = mongoose.connection.name;

  const query = { archived: { $ne: true }, studentVisibilityTier: { $in: args.tiers } };
  let cursor = ResearchEntity.find(query).select(
    `_id slug studentVisibilityTier studentVisibilityReasons sourceUrls ${EVIDENCE_FIELDS.join(' ')}`,
  );
  if (args.limit) cursor = cursor.limit(args.limit);
  const entities = await cursor.lean();

  const recordIds = entities.map(
    (entity) => serializedDocumentId((entity as { _id: unknown })._id) || '',
  );

  // One pass over live observations for the scoped records. A rolled-back or
  // superseded observation is NOT evidence: it is exactly what a prior repair
  // retired, and counting it would report retired grafts as recoverable value.
  const observed = new Map<string, Set<string>>();
  const observations = await Observation.find({
    entityType: 'researchEntity',
    field: { $in: EVIDENCE_FIELDS },
    superseded: { $ne: true },
    'rollback.rolledBackAt': { $exists: false },
    $or: [
      { entityId: { $in: entities.map((e) => (e as { _id: unknown })._id) } },
      { entityKey: { $in: entities.map((e) => String((e as { slug?: unknown }).slug || '')) } },
    ],
  })
    .select('entityId entityKey field value')
    .lean();

  const slugToId = new Map(
    entities.map((entity) => [
      String((entity as { slug?: unknown }).slug || ''),
      serializedDocumentId((entity as { _id: unknown })._id) || '',
    ]),
  );
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

  const blockersByRecord = new Map<string, string[]>();
  const inputs: RecoverabilityInputRecord[] = entities.map((entity) => {
    const record = entity as Record<string, unknown>;
    const recordId = serializedDocumentId(record._id) || '';
    const blockers = ((record.studentVisibilityReasons as string[]) || []).filter((reason) =>
      isBlockingVisibilityReason(reason),
    );
    blockersByRecord.set(recordId, blockers);
    const populatedFields = new Set(
      EVIDENCE_FIELDS.filter((field) => hasUsableValue(record[field])),
    );
    const citableSourceUrls = ((record.sourceUrls as unknown[]) || [])
      .filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
      .filter((url) => !isDisallowedResearchEntitySourceUrl(url));
    return {
      recordId,
      slug: String(record.slug || ''),
      blockers,
      populatedFields,
      observedFields: observed.get(recordId) || new Set<string>(),
      citableSourceUrls,
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
    `  CEILING      ${String(report.byBucket.ceiling).padStart(5)}   decision blocker, or no evidence and no source -> not promotable\n`,
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
