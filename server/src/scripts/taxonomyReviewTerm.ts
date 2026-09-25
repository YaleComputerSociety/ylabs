/**
 * Records one reviewer's verdict on one `TaxonomyTerm` (#3377).
 *
 * This is the writer the vocabulary never had. `buildCanonicalizerFromDatabase` reads
 * `reviewStatus: 'APPROVED'` and nothing else, so approving a term is the only way to
 * widen what any topic lane may emit, and nothing in the repository could do it: the
 * seeding migration that parked 4,619 residual scraped labels as `UNREVIEWED` "for
 * human ratification" was deleted with the rest of `data-migration/`, and it left no
 * approver behind.
 *
 * `taxonomyReviewDecisionCore` owns the fences: a reviewer and a note are required,
 * and a single-word approval needs the reviewer to say whether it belongs in the prose
 * scan. This runner owns the read and the one write.
 *
 * Per term by construction. There is no `--labels`, no file input and no bulk arm,
 * because approval is a judgement about a term and `taxonomy:review-queue` is what
 * tells a human which term to spend it on.
 *
 * Usage:
 *   yarn --cwd server taxonomy:review-term --label='Renaissance Studies' \
 *     --verdict=APPROVED --reviewed-by='<who>' --note='why'
 *   yarn --cwd server taxonomy:review-term --label='Immunology' --verdict=APPROVED \
 *     --reviewed-by='<who>' --note='why' --prose-safe-single-word \
 *     --apply --confirm-taxonomy-review
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import {
  TaxonomyTerm,
  normalizeTaxonomyLabel,
  taxonomyTermKinds,
  type TaxonomyTermKind,
} from '../models/taxonomyTerm';
import {
  AMBIGUOUS_SINGLE_WORD_AREAS,
  researchAreaMatchKey,
} from '../scrapers/researchAreaCanonicalization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import {
  planTaxonomyReviewDecision,
  taxonomyLabelIsSingleWord,
  type TaxonomyReviewVerdictInput,
} from './taxonomyReviewDecisionCore';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });

const SCRIPT_NAME = 'taxonomy:review-term';

export interface TaxonomyReviewTermArgs {
  label: string;
  kind: TaxonomyTermKind;
  verdict: TaxonomyReviewVerdictInput;
  reviewedBy: string;
  note: string;
  proseSafeSingleWord: boolean;
  apply: boolean;
  confirm: boolean;
}

export function parseTaxonomyReviewTermArgs(argv: string[]): TaxonomyReviewTermArgs {
  const args: TaxonomyReviewTermArgs = {
    label: '',
    kind: 'TOPIC',
    verdict: 'APPROVED',
    reviewedBy: '',
    note: '',
    proseSafeSingleWord: false,
    apply: false,
    confirm: false,
  };
  const value = (arg: string, flag: string) => arg.slice(flag.length).trim();
  for (const arg of argv) {
    if (arg === '--' || !arg) continue;
    if (arg === '--apply' || arg === '--mode=apply') args.apply = true;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') args.apply = false;
    else if (arg === '--confirm-taxonomy-review') args.confirm = true;
    else if (arg === '--prose-safe-single-word') args.proseSafeSingleWord = true;
    else if (arg.startsWith('--label=')) args.label = value(arg, '--label=');
    else if (arg.startsWith('--note=')) args.note = value(arg, '--note=');
    else if (arg.startsWith('--reviewed-by=')) args.reviewedBy = value(arg, '--reviewed-by=');
    else if (arg.startsWith('--kind=')) args.kind = value(arg, '--kind=') as TaxonomyTermKind;
    else if (arg.startsWith('--verdict='))
      args.verdict = value(arg, '--verdict=') as TaxonomyReviewVerdictInput;
    else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  if (!args.label) {
    throw new Error('--label is required: a review decision is about one term.');
  }
  if (!(taxonomyTermKinds as readonly string[]).includes(args.kind)) {
    throw new Error(`--kind must be one of ${taxonomyTermKinds.join(', ')}.`);
  }
  if (args.verdict !== 'APPROVED' && args.verdict !== 'DISPUTED') {
    throw new Error(
      '--verdict must be APPROVED or DISPUTED; UNREVIEWED is a state, not a verdict.',
    );
  }
  if (args.apply && !args.confirm) {
    throw new Error(
      `${SCRIPT_NAME} --apply requires --confirm-taxonomy-review; approving a term widens what every topic lane may emit.`,
    );
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseTaxonomyReviewTermArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();
  try {
    const normalizedLabel = normalizeTaxonomyLabel(args.label);
    const term = await TaxonomyTerm.findOne({ kind: args.kind, normalizedLabel }).lean<{
      _id: unknown;
      label: string;
      reviewStatus: string;
      reviewedBy?: string;
    }>();
    if (!term) {
      throw new Error(`No ${args.kind} term matches that label; nothing to review.`);
    }

    const listedAmbiguous = new Set(
      AMBIGUOUS_SINGLE_WORD_AREAS.map((name) => researchAreaMatchKey(name)),
    );
    const update = planTaxonomyReviewDecision({
      label: term.label,
      verdict: args.verdict,
      reviewedBy: args.reviewedBy,
      note: args.note,
      proseSafeSingleWord: args.proseSafeSingleWord,
      alreadyListedAmbiguous: listedAmbiguous.has(researchAreaMatchKey(term.label)),
    });

    console.log(`${SCRIPT_NAME}: ${args.apply ? 'APPLY' : 'DRY RUN'}`);
    console.log(
      `  ${JSON.stringify(term.label)} [${args.kind}] ${term.reviewStatus} -> ${update.reviewStatus}`,
    );
    console.log(`  reviewed by ${JSON.stringify(update.reviewedBy)}`);
    console.log(`  note ${JSON.stringify(update.reviewNote)}`);
    if (taxonomyLabelIsSingleWord(term.label)) {
      console.log(
        `  single-word term: prose scan ${
          listedAmbiguous.has(researchAreaMatchKey(term.label))
            ? 'excluded by AMBIGUOUS_SINGLE_WORD_AREAS'
            : 'WILL include it once approved'
        }`,
      );
    }
    if (!args.apply) {
      console.log('  no write; re-run with --apply --confirm-taxonomy-review');
      return;
    }
    // Conditioned on the review status the decision was read from, so a term another
    // reviewer moved in between is reported rather than overwritten.
    const result = await TaxonomyTerm.updateOne(
      { _id: term._id, reviewStatus: term.reviewStatus },
      { $set: update },
    );
    console.log(
      result.modifiedCount === 1
        ? '  written'
        : '  NOT written: another reviewer moved this term since it was read',
    );
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
