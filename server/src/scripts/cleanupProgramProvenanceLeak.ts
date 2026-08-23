/**
 * Dev cleanup for the program/fellowship provenance-leak defects (#1053).
 *
 * Two internal-vocabulary leaks reach student-facing program copy:
 *  - the provenance hedge "when source-confirmed" glued onto a curated
 *    compensationSummary ("$17/hour when source-confirmed"), a gating caveat
 *    that is dangling junk on the funding line students read most closely; and
 *  - a classifier display-routing directive stored as a description ("... It
 *    should be shown as funding/project support rather than a research home"),
 *    a #671-class recurrence of curation rationale rendered verbatim.
 *
 * Re-derives compensationSummary and description through the shared stored-layer
 * catalog hygiene: the hedge is stripped in place (keeping the figure), and a
 * curation/directive description fails closed to empty. Candidates are scoped to
 * records that actually carry the leak markers so unrelated prose is untouched.
 *
 * The audit trail references records by id/slug/title and prints the short,
 * non-PII compensationSummary transition; description text is reported by
 * verdict and length only, never echoed.
 *
 * Dry-run by default:
 *   yarn --cwd server tsx src/scripts/cleanupProgramProvenanceLeak.ts
 * Apply:
 *   yarn --cwd server tsx src/scripts/cleanupProgramProvenanceLeak.ts --apply --confirm-cleanup
 * Programs are Mongo-served; no Meilisearch reindex is required.
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Fellowship } from '../models/fellowship';
import { sanitizeStoredCatalogDescription } from '../utils/descriptionHygiene';
import { serializedDocumentId } from '../utils/idSerialization';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

dotenv.config();

const SCRIPT_NAME = 'cleanupProgramProvenanceLeak';

interface CliOptions {
  apply: boolean;
  confirm: boolean;
}

const parseArgs = (argv: string[]): CliOptions => ({
  apply: argv.includes('--apply'),
  confirm: argv.includes('--confirm-cleanup'),
});

const HEDGE_MARKER = 'source-confirmed';
const DIRECTIVE_MARKER = /should\s+be\s+(?:shown|displayed|surfaced|treated|classified|labell?ed|rendered)\s+as/i;

const carriesLeakMarker = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  return value.toLowerCase().includes(HEDGE_MARKER) || DIRECTIVE_MARKER.test(value);
};

interface FieldChange {
  field: 'compensationSummary' | 'description';
  beforeLen: number;
  afterLen: number;
  compensationBefore?: string;
  compensationAfter?: string;
}

interface RecordUpdate {
  id: string;
  slug: string;
  title: string;
  archived: boolean;
  changes: FieldChange[];
}

const deriveFieldChanges = (doc: Record<string, unknown>): FieldChange[] => {
  const changes: FieldChange[] = [];
  for (const field of ['compensationSummary', 'description'] as const) {
    const before = typeof doc[field] === 'string' ? (doc[field] as string) : '';
    if (!before || !carriesLeakMarker(before)) continue;
    const after = sanitizeStoredCatalogDescription(before);
    if (after === before) continue;
    changes.push({
      field,
      beforeLen: before.length,
      afterLen: after.length,
      ...(field === 'compensationSummary'
        ? { compensationBefore: before, compensationAfter: after }
        : {}),
    });
  }
  return changes;
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await initializeConnections();
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(`Target: ${guard.dbLabel} (env=${guard.environment})`);

  const docs = await Fellowship.find({
    $or: [
      { compensationSummary: { $regex: HEDGE_MARKER, $options: 'i' } },
      { description: { $regex: HEDGE_MARKER, $options: 'i' } },
      { description: { $regex: 'should be shown', $options: 'i' } },
    ],
  }).lean();
  const activeCandidates = docs.filter((doc) => doc.archived !== true).length;
  console.log(
    `Leak-marker candidates: ${docs.length} (active=${activeCandidates}, archived=${docs.length - activeCandidates})`,
  );

  const updates: RecordUpdate[] = [];
  for (const doc of docs) {
    const changes = deriveFieldChanges(doc as Record<string, unknown>);
    if (!changes.length) continue;
    updates.push({
      id: serializedDocumentId(doc._id) || '',
      slug: (doc as { sourceKey?: string }).sourceKey || '(none)',
      title: String(doc.title || '(untitled)'),
      archived: doc.archived === true,
      changes,
    });
  }

  const compChanges = updates.reduce(
    (acc, update) => acc + update.changes.filter((change) => change.field === 'compensationSummary').length,
    0,
  );
  const descChanges = updates.reduce(
    (acc, update) => acc + update.changes.filter((change) => change.field === 'description').length,
    0,
  );

  console.log(`\n=== Re-derivation (${updates.length} records) ===`);
  for (const update of updates) {
    for (const change of update.changes) {
      if (change.field === 'compensationSummary') {
        console.log(
          `  compensationSummary id=${update.id} slug=${update.slug} archived=${update.archived} ` +
            `"${update.title}": "${change.compensationBefore}" -> "${change.compensationAfter}"`,
        );
      } else {
        console.log(
          `  description id=${update.id} slug=${update.slug} archived=${update.archived} ` +
            `"${update.title}": len ${change.beforeLen} -> ${change.afterLen}`,
        );
      }
    }
  }
  console.log(
    `\nSummary: compensationSummary=${compChanges}, description=${descChanges}, ` +
      `records=${updates.length}. Mode: ${options.apply ? 'APPLY' : 'DRY-RUN'}.`,
  );

  if (!options.apply) {
    console.log('Dry-run only. Re-run with --apply --confirm-cleanup to write. No Meili reindex required.');
    await mongoose.disconnect();
    return;
  }
  if (!options.confirm) {
    throw new Error(`${SCRIPT_NAME}: --apply requires --confirm-cleanup.`);
  }

  let written = 0;
  for (const update of updates) {
    const doc = docs.find((candidate) => (serializedDocumentId(candidate._id) || '') === update.id);
    if (!doc) continue;
    const set: Record<string, string> = {};
    for (const change of update.changes) {
      const before = typeof doc[change.field] === 'string' ? (doc[change.field] as string) : '';
      set[change.field] = sanitizeStoredCatalogDescription(before);
    }
    await Fellowship.updateOne({ _id: update.id }, { $set: set });
    written += 1;
  }
  console.log(`Rewrote ${written} record(s). Programs are Mongo-served; no Meili reindex required.`);

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(`${SCRIPT_NAME} failed:`, error);
  await mongoose.disconnect();
  process.exit(1);
});
