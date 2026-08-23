/**
 * Dev cleanup for the fellowship privacy + duplicate defects (#609/#610).
 *
 * Two passes over active fellowship records:
 *  A. Description hygiene: re-derive each description through the shared catalog
 *     hygiene, stripping nav/breadcrumb/script chrome and failing closed to an
 *     empty description when the stored text is a recipient roster (PII) or a
 *     navigation dump.
 *  B. Normalized-title dedupe: group by (sourceName, normalized title),
 *     category- and sourceUrl-agnostic, keep the strongest record, and archive
 *     the rest (soft delete) with an audit trail.
 *
 * The audit trail references records by id/slug/title only and never prints
 * description text, so no leaked personal data is echoed to logs.
 *
 * Dry-run by default:
 *   yarn --cwd server tsx src/scripts/cleanupFellowshipPrivacyAndDuplicates.ts
 * Apply:
 *   yarn --cwd server tsx src/scripts/cleanupFellowshipPrivacyAndDuplicates.ts --apply --confirm-cleanup
 * Then rebuild the Meilisearch program index.
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Fellowship } from '../models/fellowship';
import { sanitizeStoredCatalogDescription } from '../utils/descriptionHygiene';
import { normalizedProgramTitleKey } from '../utils/programTitle';
import { serializedDocumentId } from '../utils/idSerialization';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

dotenv.config();

const SCRIPT_NAME = 'cleanupFellowshipPrivacyAndDuplicates';

interface CliOptions {
  apply: boolean;
  confirm: boolean;
}

const parseArgs = (argv: string[]): CliOptions => ({
  apply: argv.includes('--apply'),
  confirm: argv.includes('--confirm-cleanup'),
});

const completenessScore = (doc: any): number => {
  const fields = [
    doc.description,
    doc.summary,
    doc.applicationInformation,
    doc.applicationLink,
    doc.deadline,
    doc.eligibility,
  ];
  return fields.filter((value) => value !== undefined && value !== null && value !== '').length;
};

const updatedAtMs = (doc: any): number =>
  doc.updatedAt ? new Date(doc.updatedAt).getTime() : 0;

const isBetterKeep = (candidate: any, current: any, sanitized: Map<string, string>): boolean => {
  const candidateHasDescription = (sanitized.get(String(candidate._id)) || '').length > 0;
  const currentHasDescription = (sanitized.get(String(current._id)) || '').length > 0;
  if (candidateHasDescription !== currentHasDescription) return candidateHasDescription;
  const scoreDelta = completenessScore(candidate) - completenessScore(current);
  if (scoreDelta !== 0) return scoreDelta > 0;
  const candidateHasSourceKey = Boolean(candidate.sourceKey);
  const currentHasSourceKey = Boolean(current.sourceKey);
  if (candidateHasSourceKey !== currentHasSourceKey) return candidateHasSourceKey;
  return updatedAtMs(candidate) > updatedAtMs(current);
};

const distinctNonEmptySourceNames = (docs: any[]): number =>
  new Set(docs.map((doc) => String(doc.sourceName || '')).filter(Boolean)).size;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await initializeConnections();
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(`Target: ${guard.dbLabel} (env=${guard.environment})`);

  const docs = await Fellowship.find({ archived: { $ne: true } }).lean();
  console.log(`Active fellowships: ${docs.length}`);

  const sanitized = new Map<string, string>();
  const descriptionUpdates: Array<{ id: string; slug: string; before: number; after: number }> = [];
  for (const doc of docs) {
    const id = serializedDocumentId(doc._id) || '';
    const before = typeof doc.description === 'string' ? doc.description : '';
    const after = sanitizeStoredCatalogDescription(before);
    sanitized.set(id, after);
    if (after !== before) {
      descriptionUpdates.push({ id, slug: doc.sourceKey || '(none)', before: before.length, after: after.length });
    }
  }

  console.log(`\n=== Pass A: description hygiene (${descriptionUpdates.length} records) ===`);
  for (const update of descriptionUpdates) {
    const verdict = update.after === 0 ? 'REJECTED (roster/nav)' : 'chrome-stripped';
    console.log(`  ${verdict} id=${update.id} slug=${update.slug} len ${update.before} -> ${update.after}`);
  }

  const groups = new Map<string, any[]>();
  for (const doc of docs) {
    const key = normalizedProgramTitleKey(String(doc.title || ''));
    if (!key) continue;
    const arr = groups.get(key) || [];
    arr.push(doc);
    groups.set(key, arr);
  }

  const archiveIds: string[] = [];
  let duplicateGroups = 0;
  let skippedGroups = 0;
  console.log('\n=== Pass B: normalized-title dedupe ===');
  for (const [, arr] of groups) {
    if (arr.length < 2) continue;
    if (distinctNonEmptySourceNames(arr) > 1) {
      skippedGroups += 1;
      console.log(
        `\nSKIP (distinct sources) "${arr[0].title}": ` +
          arr.map((d) => `${serializedDocumentId(d._id)}[${d.sourceName || '(empty)'}]`).join(' '),
      );
      continue;
    }
    duplicateGroups += 1;
    let keep = arr[0];
    for (const doc of arr.slice(1)) {
      if (isBetterKeep(doc, keep, sanitized)) keep = doc;
    }
    const keepId = serializedDocumentId(keep._id) || '';
    console.log(`\nGroup "${keep.title}" (${arr.length} records) source=${keep.sourceName}`);
    console.log(`  KEEP    id=${keepId} category=${keep.programCategory} sourceUrl=${keep.sourceUrl}`);
    for (const doc of arr) {
      const docId = serializedDocumentId(doc._id) || '';
      if (docId === keepId) continue;
      console.log(`  ARCHIVE id=${docId} category=${doc.programCategory} sourceUrl=${doc.sourceUrl}`);
      archiveIds.push(docId);
    }
  }

  console.log(
    `\nSummary: descriptions to rewrite=${descriptionUpdates.length}, duplicate groups=${duplicateGroups}, records to archive=${archiveIds.length}, groups skipped for manual review=${skippedGroups}. Mode: ${options.apply ? 'APPLY' : 'DRY-RUN'}.`,
  );

  if (!options.apply) {
    console.log('Dry-run only. Re-run with --apply --confirm-cleanup to write, then rebuild Meili.');
    await mongoose.disconnect();
    return;
  }
  if (!options.confirm) {
    throw new Error(`${SCRIPT_NAME}: --apply requires --confirm-cleanup.`);
  }

  let descriptionsWritten = 0;
  for (const update of descriptionUpdates) {
    await Fellowship.updateOne(
      { _id: update.id },
      { $set: { description: sanitized.get(update.id) || '' } },
    );
    descriptionsWritten += 1;
  }
  console.log(`Rewrote ${descriptionsWritten} description(s).`);

  if (archiveIds.length > 0) {
    const result = await Fellowship.updateMany(
      { _id: { $in: archiveIds } },
      { $set: { archived: true } },
    );
    console.log(`Archived ${result.modifiedCount} duplicate record(s).`);
  }
  console.log('Done. Rebuild the Meilisearch program index to reflect these changes.');

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(`${SCRIPT_NAME} failed:`, error);
  await mongoose.disconnect();
  process.exit(1);
});
