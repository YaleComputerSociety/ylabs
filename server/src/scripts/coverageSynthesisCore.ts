import {
  SOURCE_CONTENT_HASH_FIELD,
  computeVersionedContentHash,
} from '../scrapers/contentHashGate';
import {
  COVERAGE_SNIPPET_FIELDS,
  COVERAGE_SYNTHESIS_MODEL,
  MAX_COVERAGE_SNIPPETS,
  gatherCoverageSnippets,
  isCoverageSynthesisLlmFailure,
  type CoverageObservationLike,
  type CoverageSnippet,
  type CoverageSynthesisDecision,
} from '../scrapers/coverageSynthesis';
import { COVERAGE_SYNTHESIS_PROMPT_HASH } from '../scrapers/prompts';
import { buildGrantCorpusSnippets } from './grantCorpusSynthesisCore';

export interface CoverageSynthesisArgs {
  apply: boolean;
  confirm: boolean;
  limit: number;
  all: boolean;
  rederiveCards: boolean;
  concurrency: number;
  slugs: string[];
  output?: string;
}

export const DEFAULT_COVERAGE_SYNTHESIS_LIMIT = 25;
export const DEFAULT_COVERAGE_SYNTHESIS_CONCURRENCY = 4;
const MAX_COVERAGE_SYNTHESIS_CONCURRENCY = 8;

/**
 * Folded into the evidence hash beside the prompt hash, so a change to the code-side
 * refusal arms re-judges every row once, the way a prompt edit already does.
 */
export const WRITER_CONTRACT_VERSION = 'written-description-4788-v1';

export function parseCoverageSynthesisArgs(argv: string[]): CoverageSynthesisArgs {
  const args: CoverageSynthesisArgs = {
    apply: false,
    confirm: false,
    limit: DEFAULT_COVERAGE_SYNTHESIS_LIMIT,
    all: false,
    rederiveCards: false,
    concurrency: DEFAULT_COVERAGE_SYNTHESIS_CONCURRENCY,
    slugs: [],
  };
  for (const token of argv) {
    if (token === '--apply') args.apply = true;
    else if (token === '--dry-run') args.apply = false;
    else if (token === '--confirm-coverage-synthesis') args.confirm = true;
    else if (token === '--all') args.all = true;
    else if (token === '--rederive-cards') args.rederiveCards = true;
    else if (token.startsWith('--limit=')) args.limit = Number(token.slice('--limit='.length));
    else if (token.startsWith('--concurrency=')) {
      args.concurrency = Number(token.slice('--concurrency='.length));
    } else if (token.startsWith('--slugs=')) {
      args.slugs = token
        .slice('--slugs='.length)
        .split(',')
        .map((slug) => slug.trim())
        .filter(Boolean);
    } else if (token.startsWith('--output=')) args.output = token.slice('--output='.length);
  }
  if (!Number.isFinite(args.limit) || args.limit <= 0)
    args.limit = DEFAULT_COVERAGE_SYNTHESIS_LIMIT;
  if (!Number.isFinite(args.concurrency) || args.concurrency < 1) {
    args.concurrency = DEFAULT_COVERAGE_SYNTHESIS_CONCURRENCY;
  }
  args.concurrency = Math.min(MAX_COVERAGE_SYNTHESIS_CONCURRENCY, Math.floor(args.concurrency));
  return args;
}

export function assertCoverageSynthesisApplyAllowed(
  args: CoverageSynthesisArgs,
  dbLabel: string,
): void {
  if (!args.apply) return;
  if (!args.confirm) {
    throw new Error(
      'research-entity:coverage-synthesis apply requires --confirm-coverage-synthesis (writes low-confidence LLM descriptions)',
    );
  }
  if (!/\/development$/i.test(dbLabel)) {
    throw new Error(
      `research-entity:coverage-synthesis apply is restricted to a Development database (got ${dbLabel})`,
    );
  }
}

const observationText = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

/**
 * Strongest evidence first, then a total order on the remaining keys, so the same
 * evidence always yields the same snippet list and therefore the same hash whatever
 * order the database returned it in.
 */
export function orderWriterEvidence(
  observations: readonly CoverageObservationLike[],
): CoverageObservationLike[] {
  return [...observations].sort(
    (a, b) =>
      (b.confidence ?? 0) - (a.confidence ?? 0) ||
      String(a.sourceName ?? '').localeCompare(String(b.sourceName ?? '')) ||
      a.field.localeCompare(b.field) ||
      observationText(a.value).localeCompare(observationText(b.value)),
  );
}

/**
 * Every live description-shaped observation the row carries, then its grant titles and
 * abstracts in whatever room is left, bounded by the synthesizer's own snippet cap.
 */
export function buildWriterEvidenceSnippets(
  observations: readonly CoverageObservationLike[],
  recentGrants: unknown,
): CoverageSnippet[] {
  const fromObservations = gatherCoverageSnippets(orderWriterEvidence(observations));
  const room = MAX_COVERAGE_SNIPPETS - fromObservations.length;
  if (room <= 0) return fromObservations;
  const seen = new Set(fromObservations.map((snippet) => snippet.text.toLowerCase()));
  const fromGrants = buildGrantCorpusSnippets(recentGrants).filter(
    (snippet) => !seen.has(snippet.text.toLowerCase()),
  );
  return [...fromObservations, ...fromGrants.slice(0, room)];
}

export function writerEvidenceHash(snippets: readonly CoverageSnippet[]): string {
  return computeVersionedContentHash(
    snippets.map((snippet) => snippet.text).join('\n'),
    COVERAGE_SYNTHESIS_PROMPT_HASH,
    COVERAGE_SYNTHESIS_MODEL,
    WRITER_CONTRACT_VERSION,
  );
}

export type WriterStep = 'no-evidence' | 'evidence-unchanged' | 'synthesize';

export function planWriterStep(input: {
  snippets: readonly CoverageSnippet[];
  storedHash: string | undefined;
  freshHash: string;
}): WriterStep {
  if (input.snippets.length === 0) return 'no-evidence';
  if (input.storedHash && input.storedHash === input.freshHash) return 'evidence-unchanged';
  return 'synthesize';
}

export interface WriterWrites {
  writeBody: boolean;
  retireBody: boolean;
  recordHash: boolean;
}

/**
 * What one writer step stores. The written body is a derivation of the evidence it was
 * written from, so a body the current evidence no longer supports is retired rather than
 * left to outrank the copied fallback: on a refusal, and when the row has no evidence
 * left. A failed call judged nothing, so it records no hash and the next run retries.
 */
export function writerWritesFor(
  step: WriterStep,
  decision: CoverageSynthesisDecision | null,
): WriterWrites {
  if (step === 'evidence-unchanged') {
    return { writeBody: false, retireBody: false, recordHash: false };
  }
  if (step === 'no-evidence') return { writeBody: false, retireBody: true, recordHash: false };
  if (!decision || isCoverageSynthesisLlmFailure(decision.refusal)) {
    return { writeBody: false, retireBody: false, recordHash: false };
  }
  if (decision.result) return { writeBody: true, retireBody: false, recordHash: true };
  return { writeBody: false, retireBody: true, recordHash: true };
}

/**
 * A body the store refused leaves the row judged against evidence it no longer reflects,
 * so the prior written body is retired and no hash is recorded: the next run judges the
 * row again instead of reading it as unchanged.
 */
export function writerWritesAfterBodyAttempt(
  writes: WriterWrites,
  bodyStored: boolean,
): WriterWrites {
  if (!writes.writeBody || bodyStored) return writes;
  return { writeBody: false, retireBody: true, recordHash: false };
}

export const WRITER_EVIDENCE_FIELDS: readonly string[] = [
  ...COVERAGE_SNIPPET_FIELDS,
  SOURCE_CONTENT_HASH_FIELD,
];

export function writerObservationAnchors(input: {
  entityKey?: unknown;
  entityId?: unknown;
}): Record<string, unknown>[] {
  const anchors: Record<string, unknown>[] = [];
  if (typeof input.entityKey === 'string' && input.entityKey) {
    anchors.push({ entityKey: input.entityKey });
  }
  if (input.entityId) anchors.push({ entityId: input.entityId });
  return anchors;
}

export function storedWriterEvidenceHash(
  observations: ReadonlyArray<CoverageObservationLike & { observedAt?: Date }>,
  sourceName: string,
): string | undefined {
  const hashes = observations
    .filter(
      (obs) =>
        obs.sourceName === sourceName &&
        obs.field === SOURCE_CONTENT_HASH_FIELD &&
        typeof obs.value === 'string',
    )
    .sort((a, b) => (b.observedAt?.getTime() ?? 0) - (a.observedAt?.getTime() ?? 0));
  return hashes[0]?.value as string | undefined;
}

/**
 * The rows whose card the written-body card defect left unservable: live, serving the
 * written body, and held on `missing_card_description`. `--rederive-cards` re-projects
 * only these, and calls the writer model for none of them.
 */
export function writtenBodyCardRepairFilter(sourceName: string): Record<string, unknown> {
  return {
    archived: { $ne: true },
    'fieldProvenance.fullDescription.sourceName': sourceName,
    studentVisibilityReasons: 'missing_card_description',
  };
}
