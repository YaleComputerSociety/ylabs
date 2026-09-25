/**
 * What a reviewer would gain by approving each UNREVIEWED taxonomy term, measured on
 * the served surface (#3377).
 *
 * `taxonomyReviewQueueCore` owns the classification. This runner owns the reads, and
 * the measurement is a counterfactual rather than a write: it builds a second
 * canonicalizer over the WHOLE active vocabulary, runs the real prose scan over the
 * served description of every served row that shows no topic today, and attributes
 * each newly matched term to the rows it would reach.
 *
 * Read-only by construction: no `--apply`, and nothing here changes a review state.
 * Approving a term is a per-term judgement, which is layer 3 and needs a reviewer.
 *
 * Usage:
 *   yarn --cwd server taxonomy:review-queue
 *   yarn --cwd server taxonomy:review-queue --output ./tmp/taxonomy-queue.json
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { TaxonomyTerm } from '../models/taxonomyTerm';
import {
  AMBIGUOUS_SINGLE_WORD_AREAS,
  buildResearchAreaResolverIndex,
  createResearchAreaCanonicalizer,
  researchAreaMatchKey,
} from '../scrapers/researchAreaCanonicalization';
import { toPublicResearchEntityDto } from '../services/researchEntityDto';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  classifyTaxonomyReviewCandidate,
  summarizeTaxonomyReviewQueue,
  type TaxonomyReviewCandidate,
  type TaxonomyReviewQueueSummary,
} from './taxonomyReviewQueueCore';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });

const SCRIPT_NAME = 'taxonomy:review-queue';

const textValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export interface TaxonomyReviewQueueResult {
  vocabulary: { approved: number; unreviewed: number; active: number };
  servedRows: number;
  servedRowsWithNoTopic: number;
  servedRowsAnyTermWouldReach: number;
  servedRowsWhereOnlyGainIsASingleWord: number;
  candidates: TaxonomyReviewCandidate[];
  summary: TaxonomyReviewQueueSummary;
}

export async function runTaxonomyReviewQueue(): Promise<TaxonomyReviewQueueResult> {
  const active = await TaxonomyTerm.find({ status: 'ACTIVE', archived: false })
    .select({ label: 1, aliases: 1, reviewStatus: 1 })
    .lean<Array<{ label: string; aliases?: string[]; reviewStatus: string }>>();
  const approved = active.filter((term) => term.reviewStatus === 'APPROVED');
  const unreviewed = active.filter((term) => term.reviewStatus !== 'APPROVED');

  const canonicalizerFor = (rows: typeof active) =>
    createResearchAreaCanonicalizer(
      buildResearchAreaResolverIndex(
        rows.map((row) => ({ name: row.label, aliases: row.aliases })),
      ),
    );
  const approvedCanonicalizer = canonicalizerFor(approved);
  const widenedCanonicalizer = canonicalizerFor(active);

  const rows = await ResearchEntity.find({
    studentVisibilityTier: 'student_ready',
    archived: { $ne: true },
  }).lean<Record<string, unknown>[]>();

  const rowsByTerm = new Map<string, number>();
  let servedRowsWithNoTopic = 0;
  let servedRowsAnyTermWouldReach = 0;
  let servedRowsWhereOnlyGainIsASingleWord = 0;

  for (const row of rows) {
    const dto = toPublicResearchEntityDto({ ...row }, {}) as { researchAreas?: unknown } & Record<
      string,
      unknown
    >;
    const chips = Array.isArray(dto.researchAreas) ? dto.researchAreas : [];
    if (chips.length > 0) continue;
    servedRowsWithNoTopic += 1;
    const prose = [textValue(dto.fullDescription), textValue(dto.shortDescription)]
      .filter(Boolean)
      .join(' ');
    if (!prose) continue;
    const fromApproved = new Set(approvedCanonicalizer.deriveResearchAreasFromText(prose));
    const gained = widenedCanonicalizer
      .deriveResearchAreasFromText(prose)
      .filter((area) => !fromApproved.has(area));
    if (gained.length === 0) continue;
    servedRowsAnyTermWouldReach += 1;
    if (gained.every((area) => !/\s/.test(area.trim()))) servedRowsWhereOnlyGainIsASingleWord += 1;
    for (const area of new Set(gained)) rowsByTerm.set(area, (rowsByTerm.get(area) ?? 0) + 1);
  }

  const listedAmbiguous = new Set(
    AMBIGUOUS_SINGLE_WORD_AREAS.map((name) => researchAreaMatchKey(name)),
  );
  const candidates = [...rowsByTerm.entries()].map(([label, servedRowsUnlocked]) =>
    classifyTaxonomyReviewCandidate({
      label,
      servedRowsUnlocked,
      alreadyListedAmbiguous: listedAmbiguous.has(researchAreaMatchKey(label)),
    }),
  );

  return {
    vocabulary: { approved: approved.length, unreviewed: unreviewed.length, active: active.length },
    servedRows: rows.length,
    servedRowsWithNoTopic,
    servedRowsAnyTermWouldReach,
    servedRowsWhereOnlyGainIsASingleWord,
    candidates,
    summary: summarizeTaxonomyReviewQueue(candidates),
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let output: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--output') {
      output = resolveSafeJsonReportOutputPath(args[i + 1]);
      i += 1;
    } else if (args[i].startsWith('--output=')) {
      output = resolveSafeJsonReportOutputPath(args[i].slice('--output='.length));
    } else if (args[i] !== '--') {
      throw new Error(`Unknown ${SCRIPT_NAME} argument: ${args[i]}`);
    }
  }
  await initializeConnections();
  try {
    const result = await runTaxonomyReviewQueue();
    console.log(
      `${SCRIPT_NAME}: vocabulary approved ${result.vocabulary.approved}, unreviewed ${result.vocabulary.unreviewed}`,
    );
    console.log(
      `served rows ${result.servedRows}, showing no topic ${result.servedRowsWithNoTopic}, reachable by an unreviewed term ${result.servedRowsAnyTermWouldReach}, of which only a single word would arrive on ${result.servedRowsWhereOnlyGainIsASingleWord}`,
    );
    console.log(JSON.stringify(result.summary, null, 2));
    if (output) {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(
        output,
        JSON.stringify({ generatedAt: new Date().toISOString(), ...result }, null, 2),
      );
      console.log(`Saved queue to ${output}`);
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
