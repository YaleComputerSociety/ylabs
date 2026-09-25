/**
 * Reports what the engine would derive for every `manuallyLockedFields` entry, so
 * each lock can be judged against the rule that a wrong value is fixed in the lane
 * rather than frozen on the row.
 *
 * `auditFieldLockOriginCore` owns the classification. This runner owns the reads: the
 * engine's answer per lock comes from a `dryRun` materialization with
 * `auditFieldLocksIgnoringRecord`, which is the real resolve-and-project path, and
 * the observation count comes from the same read scope the materializer uses so a
 * "no evidence" reading cannot be an artefact of a different filter.
 *
 * Read-only by construction. It has no `--apply`, and the materializer refuses
 * `auditFieldLocksIgnoringRecord` outside `dryRun`. Releasing a lock is still
 * `research-entity:release-field-locks`.
 *
 * Usage:
 *   yarn --cwd server research-entity:audit-field-locks
 *   yarn --cwd server research-entity:audit-field-locks --slugs=a,b --output ./tmp/locks.json
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { materializationReadScopeFilter, materializeEntity } from '../scrapers/entityMaterializer';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { fieldLockReason } from '../utils/researchEntityFieldLocks';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  classifyFieldLockOrigin,
  summarizeFieldLockOrigins,
  type FieldLockOriginFinding,
  type FieldLockOriginSummary,
} from './auditFieldLockOriginCore';
import type { MaterializerProjectionAnswer } from './releaseRevisitableFieldLocksCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'research-entity:audit-field-locks';

export interface AuditFieldLockOriginOptions {
  slugs: string[];
  output?: string;
}

export function parseAuditFieldLockOriginArgs(argv: string[]): AuditFieldLockOriginOptions {
  const options: AuditFieldLockOriginOptions = { slugs: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg.startsWith('--slugs=')) {
      options.slugs = arg
        .slice('--slugs='.length)
        .split(',')
        .map((slug) => slug.trim())
        .filter(Boolean);
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
    }
  }
  return options;
}

export interface AuditFieldLockOriginResult {
  findings: FieldLockOriginFinding[];
  summary: FieldLockOriginSummary;
  errors: { slug: string; message: string }[];
}

/**
 * The plan for one row with exactly `field`'s lock ignored, or no answer. The
 * `entityId` check is the same guard the release runner carries: a slug a durable
 * merge redirect resolves elsewhere would otherwise be judged against the survivor's
 * derivation.
 */
async function askEngineIgnoringOneLock(
  rowId: unknown,
  slug: string,
  field: string,
): Promise<MaterializerProjectionAnswer | undefined> {
  const answer = await materializeEntity(
    'researchEntity',
    { entityKey: slug },
    { dryRun: true, auditFieldLocksIgnoringRecord: [field] },
  );
  if (answer.entityId !== String(rowId)) return undefined;
  if (!answer.plannedSet && !answer.plannedUnset) return undefined;
  return { plannedSet: answer.plannedSet, plannedUnset: answer.plannedUnset };
}

export async function runAuditFieldLockOrigin(
  options: AuditFieldLockOriginOptions,
): Promise<AuditFieldLockOriginResult> {
  const filter: Record<string, unknown> = { manuallyLockedFields: { $exists: true, $ne: [] } };
  if (options.slugs.length > 0) filter.slug = { $in: options.slugs };
  const rows = await ResearchEntity.find(filter).lean<
    ({ _id: unknown; slug?: unknown; manuallyLockedFields?: unknown } & Record<string, unknown>)[]
  >();

  const findings: FieldLockOriginFinding[] = [];
  const errors: { slug: string; message: string }[] = [];

  for (const row of rows) {
    const slug = typeof row.slug === 'string' ? row.slug : '';
    const lockedFields = Array.isArray(row.manuallyLockedFields)
      ? row.manuallyLockedFields.filter((field): field is string => typeof field === 'string')
      : [];
    try {
      if (!slug) throw new Error('row has no slug to materialize by');
      const liveObservationCounts = new Map<string, number>();
      for (const field of lockedFields) {
        liveObservationCounts.set(
          field,
          await Observation.countDocuments({
            entityType: 'researchEntity',
            ...materializationReadScopeFilter(),
            entityKey: slug,
            field,
          }),
        );
      }
      for (const field of lockedFields) {
        findings.push(
          classifyFieldLockOrigin({
            slug,
            field,
            storedValue: row[field],
            reason: fieldLockReason(row.fieldLockProvenance, field),
            liveObservationCount: liveObservationCounts.get(field) ?? 0,
            answer: await askEngineIgnoringOneLock(row._id, slug, field),
          }),
        );
      }
    } catch (error) {
      errors.push({ slug, message: String(sanitizeLogValue(error)) });
      console.error(`${SCRIPT_NAME} failed for ${slug || '(no slug)'}:`, sanitizeLogValue(error));
    }
  }

  return { findings, summary: summarizeFieldLockOrigins(findings), errors };
}

const describeValue = (value: unknown): string => {
  if (value === undefined) return '(absent)';
  if (typeof value === 'string') return value.trim() === '' ? '(empty)' : value;
  if (Array.isArray(value)) return value.length === 0 ? '(empty list)' : `[${value.length} entries]`;
  return JSON.stringify(value) ?? String(value);
};

async function main(): Promise<void> {
  const options = parseAuditFieldLockOriginArgs(process.argv.slice(2));
  await initializeConnections();
  try {
    const result = await runAuditFieldLockOrigin(options);
    for (const finding of result.findings) {
      console.log(
        `  ${finding.slug} ${finding.field} [${finding.reason}, ${finding.liveObservationCount} live obs]\n     stored ${describeValue(
          finding.storedValue,
        )}\n     engine ${describeValue(finding.engineValue)}\n     ${finding.verdict.toUpperCase()}`,
      );
    }
    console.log(`\n${SCRIPT_NAME}:\n${JSON.stringify(result.summary, null, 2)}`);
    if (result.errors.length > 0) console.log(`errors: ${result.errors.length}`);
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(
        safeOutput,
        JSON.stringify({ generatedAt: new Date().toISOString(), ...result }, null, 2),
      );
      console.log(`Saved report to ${safeOutput}`);
    }
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
