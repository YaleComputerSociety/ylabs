/**
 * Dev cleanup for the stored evidence-excerpt redaction-marker defect (#1112).
 *
 * Both access-signal evidence (accessSummary.evidence[].excerpt) and
 * undergraduate-logistics evidence (the /programs logistics surface) are served
 * from Signal.source.excerpt. Legacy signals on both write paths stored a scraped
 * contact line already reduced by redactDirectContactInfo to a bracket
 * placeholder ("Email us at [email redacted]"); #1092 masks it at read time, but
 * the raw marker stays baked in storage. This re-runs the shared
 * sanitizeEvidenceExcerpt over every stored signal excerpt (both families) so a
 * marker-only excerpt collapses to empty and an excerpt with real remaining prose
 * keeps only its non-marker sentences.
 *
 * The audit trail references signals by id, entity slug, and signal type only;
 * it prints excerpt lengths and a verdict, never the excerpt text, so no leaked
 * content is echoed.
 *
 * Dry-run by default:
 *   yarn --cwd server tsx src/scripts/backfillEvidenceExcerptRedaction.ts
 * Apply:
 *   yarn --cwd server tsx src/scripts/backfillEvidenceExcerptRedaction.ts --apply --confirm-cleanup
 * accessSummary is computed at read time from Signal docs and is not stored in
 * Meilisearch, so no reindex is required.
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Signal } from '../models/signal';
import { ResearchEntity } from '../models/researchEntity';
import { signalTypes } from '../models/researchAccessTypes';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { sanitizeEvidenceExcerpt } from '../utils/descriptionHygiene';
import { serializedDocumentId } from '../utils/idSerialization';
import { omitReviewLockedFields } from '../services/reviewLockUtils';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

dotenv.config();

const SCRIPT_NAME = 'backfillEvidenceExcerptRedaction';

interface CliOptions {
  apply: boolean;
  confirm: boolean;
}

const parseArgs = (argv: string[]): CliOptions => ({
  apply: argv.includes('--apply'),
  confirm: argv.includes('--confirm-cleanup'),
});

type Verdict = 'dropped-marker-only' | 'stripped-marker-sentence';

interface PlannedUpdate {
  id: string;
  slug: string;
  signalType: string;
  verdict: Verdict;
  beforeLen: number;
  afterLen: number;
  after: string;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await initializeConnections();
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(`Target: ${guard.dbLabel} (env=${guard.environment})`);

  const signals = await Signal.find({
    type: { $in: signalTypes },
    archived: false,
    'source.excerpt': { $exists: true, $ne: '' },
  })
    .select({
      _id: 1,
      researchEntityId: 1,
      type: 1,
      'source.excerpt': 1,
      'review.status': 1,
      'review.lockedFields': 1,
    })
    .lean();
  console.log(`Served signals with a stored excerpt: ${signals.length}`);

  const entityIds = Array.from(
    new Set(signals.map((signal) => serializedDocumentId(signal.researchEntityId)).filter(Boolean)),
  ) as string[];
  const entities = await ResearchEntity.find({ _id: { $in: entityIds } })
    .select({ _id: 1, slug: 1 })
    .lean();
  const slugById = new Map(
    entities.map((entity) => [serializedDocumentId(entity._id) || '', String(entity.slug || '(none)')]),
  );

  const updates: PlannedUpdate[] = [];
  for (const signal of signals) {
    const before = String(signal.source?.excerpt || '');
    if (!before) continue;
    const hasContactMarker = /\[(?:email|phone) redacted\]/i.test(redactDirectContactInfo(before));
    if (!hasContactMarker) continue;
    const sanitized = sanitizeEvidenceExcerpt(before);
    const after = sanitized ?? '';
    if (after === before) continue;
    const writable = omitReviewLockedFields({ 'source.excerpt': after }, signal as any);
    if (!('source.excerpt' in writable)) continue;
    updates.push({
      id: serializedDocumentId(signal._id) || '',
      slug: slugById.get(serializedDocumentId(signal.researchEntityId) || '') || '(none)',
      signalType: String(signal.type || '(unknown)'),
      verdict: after ? 'stripped-marker-sentence' : 'dropped-marker-only',
      beforeLen: before.length,
      afterLen: after.length,
      after,
    });
  }

  const affectedEntities = new Set(updates.map((update) => update.slug));
  const counts = updates.reduce<Record<Verdict, number>>(
    (acc, update) => {
      acc[update.verdict] += 1;
      return acc;
    },
    { 'dropped-marker-only': 0, 'stripped-marker-sentence': 0 },
  );

  console.log(`\n=== Evidence-excerpt re-sanitization (${updates.length} signals) ===`);
  for (const update of updates) {
    console.log(
      `  ${update.verdict} id=${update.id} slug=${update.slug} type=${update.signalType} len ${update.beforeLen} -> ${update.afterLen}`,
    );
  }
  console.log(
    `\nSummary: dropped-marker-only=${counts['dropped-marker-only']}, ` +
      `stripped-marker-sentence=${counts['stripped-marker-sentence']}, ` +
      `signals=${updates.length}, entities=${affectedEntities.size}. ` +
      `Mode: ${options.apply ? 'APPLY' : 'DRY-RUN'}.`,
  );

  if (!options.apply) {
    console.log(
      'Dry-run only. Re-run with --apply --confirm-cleanup to write. accessSummary is read-time; no Meili reindex required.',
    );
    await mongoose.disconnect();
    return;
  }
  if (!options.confirm) {
    throw new Error(`${SCRIPT_NAME}: --apply requires --confirm-cleanup.`);
  }

  let written = 0;
  for (const update of updates) {
    await Signal.updateOne({ _id: update.id }, { $set: { 'source.excerpt': update.after } });
    written += 1;
  }
  console.log(
    `Rewrote ${written} signal excerpt(s). accessSummary is read-time; no Meili reindex required.`,
  );

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(`${SCRIPT_NAME} failed:`, error);
  await mongoose.disconnect();
  process.exit(1);
});
