/**
 * Reports which rows a resolver improvement has not reached, and which of those a
 * bounded rematerialize could deliver without overwriting anything (#3332).
 *
 * `auditFrozenDescriptionsCore` owns the classification. This runner owns the reads,
 * and two of them are load bearing.
 *
 * The candidate set is narrowed before any projection runs: only a row whose SERVED
 * description field is empty while the corpus holds a live observation for it can gain
 * from re-resolution, and there are two orders of magnitude fewer of those than there
 * are rows whose resolved value differs from stored. A census over the wider set is
 * what produced #3163's 203, of which 13 were defects.
 *
 * The before and after are read through `sanitizeServedResearchEntityCopyFields`, the
 * canonical served-copy chain, never through the inner pass it wraps. An earlier
 * measurement in this family read the inner pass and reported 229 rows for a defect
 * that serves on none of them.
 *
 * Read-only: no `--apply`. Delivery is `research-entity:rematerialize --slugs=...
 * --only-fields=fullDescription,shortDescription`, and `--slugs-out` writes the list
 * for it. Re-running this afterwards is the verification, because the selector and the
 * verifier are the same query.
 *
 * Usage:
 *   yarn --cwd server research-entity:audit-frozen-descriptions
 *   yarn --cwd server research-entity:audit-frozen-descriptions --output ./tmp/frozen.json \
 *     --slugs-out ./tmp/frozen-slugs.txt
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
import { sanitizeServedResearchEntityCopyFields } from '../utils/researchEntityDescriptionText';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  FROZEN_DESCRIPTION_FIELDS,
  classifyFrozenDescription,
  deliverableSlugs,
  summarizeFrozenDescriptions,
  type FrozenDescriptionFinding,
  type FrozenDescriptionSummary,
} from './auditFrozenDescriptionsCore';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });

const SCRIPT_NAME = 'research-entity:audit-frozen-descriptions';

export interface AuditFrozenDescriptionsOptions {
  output?: string;
  slugsOut?: string;
  limit?: number;
}

export function parseAuditFrozenDescriptionsArgs(argv: string[]): AuditFrozenDescriptionsOptions {
  const options: AuditFrozenDescriptionsOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else if (arg === '--slugs-out') {
      options.slugsOut = String(argv[i + 1] ?? '').trim();
      i += 1;
    } else if (arg.startsWith('--slugs-out=')) {
      options.slugsOut = arg.slice('--slugs-out='.length).trim();
    } else if (arg.startsWith('--limit=')) {
      options.limit = Number(arg.slice('--limit='.length));
    } else {
      throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
    }
  }
  return options;
}

export interface AuditFrozenDescriptionsResult {
  findings: FrozenDescriptionFinding[];
  summary: FrozenDescriptionSummary;
  candidateRows: number;
  deliverable: string[];
  errors: { slug: string; message: string }[];
}

const textValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export async function runAuditFrozenDescriptions(
  options: AuditFrozenDescriptionsOptions = {},
): Promise<AuditFrozenDescriptionsResult> {
  const rows = await ResearchEntity.find({ archived: { $ne: true } }).lean<
    (Record<string, unknown> & { _id: unknown; slug?: unknown })[]
  >();

  const liveCounts = await Observation.aggregate([
    {
      $match: {
        entityType: 'researchEntity',
        ...materializationReadScopeFilter(),
        field: { $in: [...FROZEN_DESCRIPTION_FIELDS] },
      },
    },
    { $group: { _id: { key: '$entityKey', field: '$field' }, n: { $sum: 1 } } },
  ]);
  const liveByKeyField = new Map<string, number>();
  for (const entry of liveCounts as { _id: { key: unknown; field: unknown }; n: number }[]) {
    liveByKeyField.set(`${String(entry._id.key)}\u0000${String(entry._id.field)}`, entry.n);
  }
  const liveCount = (slug: string, field: string): number =>
    liveByKeyField.get(`${slug}\u0000${field}`) ?? 0;

  // Only a row with an empty served field and live evidence for it can gain, and
  // narrowing here is what keeps the projection cost proportional to the defect
  // rather than to the corpus.
  const candidates = rows.filter((row) => {
    const slug = textValue(row.slug);
    if (!slug) return false;
    const served = sanitizeServedResearchEntityCopyFields(row, []) as Record<string, unknown>;
    return FROZEN_DESCRIPTION_FIELDS.some(
      (field) => !textValue(served[field]) && liveCount(slug, field) > 0,
    );
  });

  const probed = options.limit ? candidates.slice(0, options.limit) : candidates;
  const findings: FrozenDescriptionFinding[] = [];
  const errors: { slug: string; message: string }[] = [];

  for (const row of probed) {
    const slug = textValue(row.slug);
    try {
      const plan = await materializeEntity('researchEntity', { entityKey: slug }, { dryRun: true });
      // A slug a durable merge redirect resolves elsewhere would otherwise be judged
      // against the survivor's projection.
      const answers = plan.entityId === String(row._id) ? (plan.plannedSet ?? {}) : {};
      const projected: Record<string, unknown> = { ...row };
      for (const field of FROZEN_DESCRIPTION_FIELDS) {
        if (field in answers) projected[field] = answers[field];
      }
      const before = sanitizeServedResearchEntityCopyFields(row, []) as Record<string, unknown>;
      const after = sanitizeServedResearchEntityCopyFields(projected, []) as Record<
        string,
        unknown
      >;
      for (const field of FROZEN_DESCRIPTION_FIELDS) {
        findings.push(
          classifyFrozenDescription({
            slug,
            field,
            tier: textValue(row.studentVisibilityTier),
            liveObservationCount: liveCount(slug, field),
            projectionNamesField: field in answers,
            servedBefore: textValue(before[field]),
            servedAfter: textValue(after[field]),
          }),
        );
      }
    } catch (error) {
      errors.push({ slug, message: String(sanitizeLogValue(error)) });
      console.error(`${SCRIPT_NAME} failed for ${slug}:`, sanitizeLogValue(error));
    }
  }

  return {
    findings,
    summary: summarizeFrozenDescriptions(findings),
    candidateRows: candidates.length,
    deliverable: deliverableSlugs(findings),
    errors,
  };
}

async function main(): Promise<void> {
  const options = parseAuditFrozenDescriptionsArgs(process.argv.slice(2));
  await initializeConnections();
  try {
    const result = await runAuditFrozenDescriptions(options);
    console.log(`${SCRIPT_NAME}: candidate rows ${result.candidateRows}`);
    console.log(JSON.stringify(result.summary, null, 2));
    console.log(
      `deliverable rows (a served fill and no served regression): ${result.deliverable.length}`,
    );
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
    if (options.slugsOut) {
      const safeSlugs = resolveSafeJsonReportOutputPath(`${options.slugsOut}.json`).replace(
        /\.json$/,
        '',
      );
      fs.mkdirSync(path.dirname(safeSlugs), { recursive: true });
      fs.writeFileSync(safeSlugs, result.deliverable.join(','));
      console.log(`Saved deliverable slugs to ${safeSlugs}`);
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
