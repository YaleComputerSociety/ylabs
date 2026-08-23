/**
 * One-time re-sanitize backfill for the residual mid-word/no-terminal-punctuation
 * truncation #897/PR#923 fixed at the write path but never backfilled onto
 * already-stored records (#1240).
 *
 * `sanitizeResearchEntityDescription`'s final `clampDescriptionLength` step is a
 * no-op whenever the stored text is already at or under the 2000-char cap, so a
 * value hard-sliced by an upstream faculty/roster scraper before #923 (or cut by
 * any other length-limited source) stays cut mid-word forever unless it is
 * separately repaired. `clampDescriptionLength`'s own sentence-boundary branch
 * is not reused here: it searches for the last `[.!?]` anywhere in the text,
 * which can roll back across a long trailing list/keyword segment that has no
 * internal punctuation and discard a large amount of otherwise-fine content.
 * Since these values are not actually over the length cap, the correct minimal
 * fix is narrower: drop only the truncated trailing word and mark the cut with
 * an ellipsis (`dropTrailingIncompleteWord` below).
 *
 * Scope is deliberately narrow: only `fullDescription`/`shortDescription`
 * values that already look mid-word-truncated (no terminal sentence punctuation
 * or ellipsis, ending on a word character, and long enough that a short
 * intentionally-unpunctuated blurb can't be mistaken for a cut) are touched.
 * A record whose current sanitizer output fails closed for an unrelated
 * hygiene reason (contact block, publications dump, etc.) is left untouched and
 * reported separately for manual review rather than silently blanked as a
 * side effect of this truncation-focused pass.
 *
 * Dry-run by default:
 *   yarn --cwd server tsx src/scripts/backfillResearchEntityTruncatedDescriptions.ts
 * Apply:
 *   yarn --cwd server tsx src/scripts/backfillResearchEntityTruncatedDescriptions.ts --apply --confirm-description-truncation-backfill
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { syncEntities } from '../services/meiliSyncService';
import {
  sanitizeResearchEntityDescription,
  sanitizeResearchEntityShortDescription,
} from '../utils/descriptionHygiene';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

dotenv.config();

const SCRIPT_NAME = 'backfillResearchEntityTruncatedDescriptions';
const MIN_TRUNCATION_CHECK_LENGTH = 250;
const DESCRIPTION_FIELDS = ['fullDescription', 'shortDescription'] as const;
type DescriptionField = (typeof DESCRIPTION_FIELDS)[number];

interface CliOptions {
  apply: boolean;
  confirm: boolean;
  syncMeili: boolean;
  limit?: number;
  output?: string;
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  if (!value || value.startsWith('--') || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { apply: false, confirm: false, syncMeili: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--mode=apply') options.apply = true;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') options.apply = false;
    else if (arg === '--confirm-description-truncation-backfill') options.confirm = true;
    else if (arg === '--no-sync') options.syncMeili = false;
    else if (arg.startsWith('--limit=')) options.limit = parsePositiveInt(arg.slice('--limit='.length), '--limit');
    else if (arg === '--limit') {
      options.limit = parsePositiveInt(argv[i + 1], '--limit');
      i += 1;
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

const endsOnCompleteSentence = (text: string): boolean => /[.!?]["')\]]?$/.test(text.trim());
const endsWithEllipsis = (text: string): boolean => /(?:\.\.\.|…)\s*$/.test(text.trim());
const endsOnWordCharacter = (text: string): boolean => /[A-Za-z0-9]$/.test(text.trim());

export function isMidWordTruncated(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < MIN_TRUNCATION_CHECK_LENGTH) return false;
  if (endsOnCompleteSentence(trimmed)) return false;
  if (endsWithEllipsis(trimmed)) return false;
  return endsOnWordCharacter(trimmed);
}

/**
 * Drop only the final (truncated) word and mark the cut with an ellipsis.
 * Deliberately narrower than `clampDescriptionLength`'s sentence-boundary
 * branch: rolling back to the last `[.!?]` anywhere in the text can discard a
 * long trailing list/keyword segment that legitimately has no internal
 * punctuation, which is real content loss for a value that is not actually
 * over the length cap. The minimal fix here is to remove exactly the
 * incomplete trailing fragment.
 */
export function dropTrailingIncompleteWord(text: string): string {
  const trimmed = text.trim();
  const lastSpace = trimmed.lastIndexOf(' ');
  const cut = lastSpace > 0 ? trimmed.slice(0, lastSpace) : trimmed;
  return `${cut.trim()}…`;
}

type Verdict = 'truncation-repaired' | 'needs-review-fail-closed';

interface FieldChange {
  id: string;
  slug: string;
  field: DescriptionField;
  verdict: Verdict;
  after: string;
  beforeLength: number;
  afterLength: number;
  beforeTail: string;
  afterTail: string;
}

const TAIL_CHARS = 90;
const tailOf = (text: string): string => (text.length <= TAIL_CHARS ? text : text.slice(-TAIL_CHARS));

function deriveField(before: string, field: DescriptionField): { after: string } | { failedClosed: true } {
  const sanitized =
    field === 'fullDescription'
      ? sanitizeResearchEntityDescription(before)
      : sanitizeResearchEntityShortDescription(before);
  if (!sanitized) return { failedClosed: true };
  const after = isMidWordTruncated(sanitized) ? dropTrailingIncompleteWord(sanitized) : sanitized;
  return { after };
}

interface EntityRow {
  _id: unknown;
  slug?: string;
  fullDescription?: unknown;
  shortDescription?: unknown;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.apply && !options.confirm) {
    throw new Error(`${SCRIPT_NAME}: --apply requires --confirm-description-truncation-backfill.`);
  }

  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(`Target: ${guard.dbLabel} (env=${guard.environment}); mode=${options.apply ? 'apply' : 'dry-run'}`);

  await initializeConnections();
  try {
    const query = ResearchEntity.find(
      { archived: { $ne: true } },
      { _id: 1, slug: 1, fullDescription: 1, shortDescription: 1 },
    ).sort({ _id: 1 });
    if (options.limit) query.limit(options.limit);
    const docs = (await query.lean()) as EntityRow[];
    console.log(`Active research entities scanned: ${docs.length}`);

    const changes: FieldChange[] = [];
    const needsReview: FieldChange[] = [];

    for (const doc of docs) {
      const id = serializedDocumentId(doc._id) || String(doc._id);
      const slug = doc.slug || '(none)';
      for (const field of DESCRIPTION_FIELDS) {
        const before = typeof doc[field] === 'string' ? (doc[field] as string) : '';
        if (!before || !isMidWordTruncated(before)) continue;
        const result = deriveField(before, field);
        if ('failedClosed' in result) {
          needsReview.push({
            id,
            slug,
            field,
            verdict: 'needs-review-fail-closed',
            after: '',
            beforeLength: before.length,
            afterLength: 0,
            beforeTail: tailOf(before),
            afterTail: '',
          });
          continue;
        }
        if (result.after !== before) {
          changes.push({
            id,
            slug,
            field,
            verdict: 'truncation-repaired',
            after: result.after,
            beforeLength: before.length,
            afterLength: result.after.length,
            beforeTail: tailOf(before),
            afterTail: tailOf(result.after),
          });
        }
      }
    }

    console.log(`\n=== Truncation repair (${changes.length} field(s) across ${new Set(changes.map((c) => c.id)).size} entit(y/ies)) ===`);
    for (const change of changes) {
      console.log(
        `  ${change.field} slug=${change.slug} len ${change.beforeLength} -> ${change.afterLength}\n` +
          `    before: ...${JSON.stringify(change.beforeTail)}\n` +
          `    after:  ...${JSON.stringify(change.afterTail)}`,
      );
    }
    if (needsReview.length > 0) {
      console.log(`\n=== Needs manual review (${needsReview.length}, sanitizer fails closed for an unrelated reason, NOT touched) ===`);
      for (const row of needsReview) {
        console.log(`  ${row.field} slug=${row.slug} len ${row.beforeLength} before: ...${JSON.stringify(row.beforeTail)}`);
      }
    }

    const payload = {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      mode: options.apply ? 'apply' : 'dry-run',
      scanned: docs.length,
      changedFieldCount: changes.length,
      changedEntityCount: new Set(changes.map((c) => c.id)).size,
      needsReviewCount: needsReview.length,
      changes,
      needsReview,
    };
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(safeOutput, `${JSON.stringify(payload, null, 2)}\n`);
      console.log(`Saved report to ${safeOutput}`);
    }

    if (!options.apply) {
      console.log(
        `\nDry-run only. ${changes.length} field(s) would change. Re-run with --apply --confirm-description-truncation-backfill to write.`,
      );
      return;
    }

    const changedIds = Array.from(new Set(changes.map((change) => change.id)));
    for (const id of changedIds) {
      const set: Record<string, string> = {};
      for (const change of changes.filter((candidate) => candidate.id === id)) {
        set[change.field] = change.after;
      }
      await ResearchEntity.updateOne({ _id: id }, { $set: set });
    }
    console.log(`Rewrote ${changedIds.length} entit(y/ies), ${changes.length} field(s).`);

    if (options.syncMeili && changedIds.length > 0) {
      const freshDocs = await ResearchEntity.find({ _id: { $in: changedIds } }).lean();
      await syncEntities('researchEntity', freshDocs);
      console.log(`Synced ${freshDocs.length} entit(y/ies) to Meilisearch.`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`${SCRIPT_NAME} failed:`, sanitizeLogValue(error));
    process.exit(1);
  });
}
