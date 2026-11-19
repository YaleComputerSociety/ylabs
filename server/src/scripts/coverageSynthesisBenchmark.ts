import {
  COVERAGE_SYNTHESIS_MODEL,
  WRITTEN_DESCRIPTION_SOURCE_NAME,
  defaultCoverageSynthesisLLM,
  type CoverageSynthesisLLMFn,
  type CoverageSynthesisRefusal,
  type CoverageSynthesisRefusalDetails,
} from '../scrapers/coverageSynthesis';
import {
  benchmarkCacheRead,
  benchmarkCacheWrite,
  isBenchmarkModeActive,
  isBenchmarkReplayActive,
  isLiveModelReplayActive,
} from '../scrapers/snapshotBenchmarkMode';
import {
  loadIngestVerifiedRunIds,
  loadWriterEntitiesBySlug,
  loadWriterRowEvidence,
  parseWriterEvidenceFile,
  WRITER_EVIDENCE_FILE_VERSION,
  type WriterRowEvidence,
} from './coverageSynthesisEvidence';
import { runWriterEvaluation, type WriterEvaluationRow } from './coverageSynthesisEvaluate';
import type { PlannedObservation } from './laneScorecardCore';
import {
  writerModelThroughCache,
  type StoredWrittenDescriptionDerivation,
  type WrittenDescriptionDerivationStore,
} from './writtenDescriptionDerivationCore';

export const WRITER_BENCHMARK_LANE = WRITTEN_DESCRIPTION_SOURCE_NAME;
export const WRITER_EVIDENCE_BENCHMARK_NAMESPACE = 'coverage-synthesis-evidence';
const FROZEN_REPLAY_API_KEY = 'frozen-benchmark-replay';

export interface WriterBenchmarkRow {
  slug: string;
  step: WriterEvaluationRow['step'];
  refusalReasons: CoverageSynthesisRefusal[];
  refusalDetails?: CoverageSynthesisRefusalDetails;
  inputHash?: string;
}

export interface WriterBenchmarkRun {
  observations: PlannedObservation[];
  truncated: boolean;
  writerRows: WriterBenchmarkRow[];
}

/**
 * A benchmark must not read or fill the shared draft cache: a cached draft would answer
 * without a model request, so capture would freeze nothing and replay would read a cache
 * entry another run wrote.
 */
function runLocalDraftStore(): WrittenDescriptionDerivationStore {
  const entries = new Map<string, StoredWrittenDescriptionDerivation>();
  return {
    find: async (inputHash) => entries.get(inputHash) ?? null,
    save: async (record) => {
      entries.set(record.inputHash, record);
    },
  };
}

async function frozenOrLiveEvidence(slugs: readonly string[]): Promise<WriterRowEvidence[]> {
  const isCapture = isBenchmarkModeActive() && !isBenchmarkReplayActive();
  if (isBenchmarkReplayActive()) {
    return slugs.flatMap((slug) => {
      const read = benchmarkCacheRead(WRITER_EVIDENCE_BENCHMARK_NAMESPACE, slug);
      const json = read.handled ? (read.payload as { json?: unknown } | null)?.json : undefined;
      return typeof json === 'string' ? [JSON.parse(json) as WriterRowEvidence] : [];
    });
  }
  const rows = await loadWriterRowEvidence(
    await loadWriterEntitiesBySlug(slugs),
    await loadIngestVerifiedRunIds(),
  );
  if (isCapture) {
    for (const row of rows) {
      benchmarkCacheRead(WRITER_EVIDENCE_BENCHMARK_NAMESPACE, row.slug);
      benchmarkCacheWrite(WRITER_EVIDENCE_BENCHMARK_NAMESPACE, row.slug, {
        json: JSON.stringify(row),
      });
    }
  }
  return JSON.parse(JSON.stringify(rows)) as WriterRowEvidence[];
}

function apiKeyForRun(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) return apiKey;
  if (isBenchmarkReplayActive() && !isLiveModelReplayActive()) return FROZEN_REPLAY_API_KEY;
  throw new Error(`${WRITER_BENCHMARK_LANE} benchmark capture requires OPENAI_API_KEY`);
}

/**
 * The writer as a benchmarkable lane. Its input is each row's writer evidence rather than a
 * fetched page, frozen under its own namespace, and its model calls go over the default axios
 * instance, so the existing capture and replay freeze them. The reference date stands in for
 * the clock in both the grant window and the prompt's TODAY line, or a replay on a later day
 * would ask a different question.
 */
export async function runWriterBenchmarkDry(spec: {
  only: readonly string[];
  referenceDate?: Date;
  callLLM?: CoverageSynthesisLLMFn;
}): Promise<WriterBenchmarkRun> {
  if (spec.only.length === 0) {
    throw new Error(`${WRITER_BENCHMARK_LANE} benchmarks need an --only scope of row slugs`);
  }
  const now = spec.referenceDate ?? new Date();
  const slugs = [...new Set(spec.only)].sort();
  const rows = parseWriterEvidenceFile({
    version: WRITER_EVIDENCE_FILE_VERSION,
    capturedAt: now.toISOString(),
    db: '',
    rows: await frozenOrLiveEvidence(slugs),
  }).rows;
  const callLLM =
    spec.callLLM ??
    defaultCoverageSynthesisLLM(apiKeyForRun(), COVERAGE_SYNTHESIS_MODEL, () => now);
  const store = runLocalDraftStore();
  const report = await runWriterEvaluation({
    rows,
    store,
    drafting: writerModelThroughCache({ callLLM, store, now: () => now }),
    evidenceNow: now,
    concurrency: 1,
  });
  return {
    observations: report.rows.flatMap((row) =>
      row.description
        ? [
            {
              entityType: 'researchEntity',
              entityKey: row.slug,
              field: 'fullDescription',
              value: row.description,
              sourceName: WRITER_BENCHMARK_LANE,
            },
          ]
        : [],
    ),
    truncated: false,
    writerRows: report.rows.map((row) => ({
      slug: row.slug,
      step: row.step,
      refusalReasons: row.refusalReasons,
      ...(row.refusalDetails ? { refusalDetails: row.refusalDetails } : {}),
      ...(row.inputHash ? { inputHash: row.inputHash } : {}),
    })),
  };
}

export function summarizeWriterSteps(rows: readonly WriterBenchmarkRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.step] = (counts[row.step] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}
