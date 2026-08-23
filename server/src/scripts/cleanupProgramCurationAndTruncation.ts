/**
 * Dev cleanup for the program/fellowship description-quality defects (#671).
 *
 * Re-derives every active program/fellowship description through the shared
 * catalog hygiene so stored copy goes clean-or-empty:
 *  - internal curation / reviewer-rationale prose ("is source-backed", "safe to
 *    show prominently", "operators should refresh", "keep public copy restrained
 *    until ... is attached") fails closed to an empty description;
 *  - leaked [email redacted] / [phone redacted] placeholder tokens are stripped;
 *  - descriptions hard-cut mid-word at the legacy 2000-char cap are repaired to
 *    end on a complete sentence (or a word boundary with an ellipsis).
 *
 * The audit trail references records by id/slug/title and a verdict category
 * only; it never prints description text, so no leaked content is echoed.
 *
 * Dry-run by default:
 *   yarn --cwd server tsx src/scripts/cleanupProgramCurationAndTruncation.ts
 * Apply:
 *   yarn --cwd server tsx src/scripts/cleanupProgramCurationAndTruncation.ts --apply --confirm-cleanup
 * Programs are Mongo-served; no Meilisearch reindex is required.
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Fellowship } from '../models/fellowship';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import {
  clampDescriptionLength,
  isCurationRationaleText,
  sanitizeCatalogDescription,
} from '../utils/descriptionHygiene';
import { serializedDocumentId } from '../utils/idSerialization';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

dotenv.config();

const SCRIPT_NAME = 'cleanupProgramCurationAndTruncation';
const LEGACY_TRUNCATION_CAP = 2000;

interface CliOptions {
  apply: boolean;
  confirm: boolean;
}

const parseArgs = (argv: string[]): CliOptions => ({
  apply: argv.includes('--apply'),
  confirm: argv.includes('--confirm-cleanup'),
});

type Verdict = 'curation-rejected' | 'email-token-stripped' | 'truncation-repaired' | 'chrome-stripped';

const endsOnCompleteSentence = (text: string): boolean => /[.!?]["')\]]?$/.test(text.trim());

const hasContactToRedact = (before: string): boolean =>
  /\[(?:email|phone) redacted\]/i.test(before) || redactDirectContactInfo(before) !== before;

const deriveDescription = (before: string): { after: string; verdict: Verdict } => {
  const curation = isCurationRationaleText(before);
  let after = sanitizeCatalogDescription(redactDirectContactInfo(before));
  const wasHardCapped =
    before.length === LEGACY_TRUNCATION_CAP && after.length > 0 && !endsOnCompleteSentence(after);
  if (wasHardCapped) after = clampDescriptionLength(after, after.length - 1);
  const verdict: Verdict = curation
    ? 'curation-rejected'
    : wasHardCapped
      ? 'truncation-repaired'
      : hasContactToRedact(before)
        ? 'email-token-stripped'
        : 'chrome-stripped';
  return { after, verdict };
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

  const docs = await Fellowship.find({ archived: { $ne: true } }).lean();
  console.log(`Active programs/fellowships: ${docs.length}`);

  const updates: Array<{ id: string; slug: string; title: string; verdict: Verdict; before: number; after: number }> = [];
  for (const doc of docs) {
    const before = typeof doc.description === 'string' ? doc.description : '';
    if (!before) continue;
    const { after, verdict } = deriveDescription(before);
    if (after !== before) {
      updates.push({
        id: serializedDocumentId(doc._id) || '',
        slug: doc.sourceKey || '(none)',
        title: String(doc.title || '(untitled)'),
        verdict,
        before: before.length,
        after: after.length,
      });
    }
  }

  const counts = updates.reduce<Record<Verdict, number>>(
    (acc, update) => {
      acc[update.verdict] += 1;
      return acc;
    },
    { 'curation-rejected': 0, 'email-token-stripped': 0, 'truncation-repaired': 0, 'chrome-stripped': 0 },
  );

  console.log(`\n=== Description re-derivation (${updates.length} records) ===`);
  for (const update of updates) {
    console.log(
      `  ${update.verdict} id=${update.id} slug=${update.slug} len ${update.before} -> ${update.after} "${update.title}"`,
    );
  }
  console.log(
    `\nSummary: curation-rejected=${counts['curation-rejected']}, email-token-stripped=${counts['email-token-stripped']}, ` +
      `truncation-repaired=${counts['truncation-repaired']}, chrome-stripped=${counts['chrome-stripped']}, ` +
      `total=${updates.length}. Mode: ${options.apply ? 'APPLY' : 'DRY-RUN'}.`,
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
    const before = typeof doc?.description === 'string' ? doc.description : '';
    await Fellowship.updateOne(
      { _id: update.id },
      { $set: { description: deriveDescription(before).after } },
    );
    written += 1;
  }
  console.log(`Rewrote ${written} description(s). Programs are Mongo-served; no Meili reindex required.`);

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(`${SCRIPT_NAME} failed:`, error);
  await mongoose.disconnect();
  process.exit(1);
});
