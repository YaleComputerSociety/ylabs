import type { ResearchEntityType } from '../models/researchAccessTypes';
import { mongooseConnectionWasOpened } from '../utils/mongooseConnectionWasOpened';
import { WrittenDescriptionDerivation } from '../models/writtenDescriptionDerivation';
import { computeContentHash } from '../scrapers/contentHashGate';
import {
  COVERAGE_SYNTHESIS_MODEL,
  coverageSynthesisDecision,
  type CoverageSnippet,
  type CoverageSynthesisDecision,
  type CoverageSynthesisLLMFn,
  type CoverageSynthesisLLMResult,
  type CoverageSynthesisRefusal,
  type CoverageSynthesisRefusalDetails,
} from '../scrapers/coverageSynthesis';
import { COVERAGE_SYNTHESIS_PROMPT_HASH } from '../scrapers/prompts';
import { RESEARCH_PAGE_TEXT_SOURCE } from '../scrapers/utils/researchPageText';
import {
  WRITER_TEXT_NORMALIZER_VERSION,
  normalizeWriterText,
  researchPageHeadingHashes,
  writerEvidenceSentenceHashes,
} from '../scrapers/utils/writerEvidenceText';

/**
 * Part of the writer's input hash, so a change to the code-side refusal arms re-judges
 * every row once.
 */
export const WRITER_CONTRACT_VERSION = 'written-description-5537-v1';

export const WRITER_MATERIAL_CHANGE_MIN_JACCARD = 0.9;

export interface WriterInputs {
  promptHash: string;
  model: string;
  writer: string;
}

export const openAiWriterId = (model: string): string => `openai:${model}`;

export const CURRENT_WRITER_INPUTS: WriterInputs = {
  promptHash: COVERAGE_SYNTHESIS_PROMPT_HASH,
  model: COVERAGE_SYNTHESIS_MODEL,
  writer: openAiWriterId(COVERAGE_SYNTHESIS_MODEL),
};

export function writerInputHash(
  snippets: readonly CoverageSnippet[],
  model: string = COVERAGE_SYNTHESIS_MODEL,
): string {
  return computeContentHash(
    JSON.stringify({
      snippets: snippets.map((snippet) => normalizeWriterText(snippet.text)),
      model,
      contract: WRITER_CONTRACT_VERSION,
      normalizer: WRITER_TEXT_NORMALIZER_VERSION,
    }),
  );
}

export interface WriterEvidenceFingerprint {
  snippetSentenceHashes: string[][];
  researchPageHeadingHashes: string[];
}

export function writerEvidenceFingerprint(
  snippets: readonly CoverageSnippet[],
): WriterEvidenceFingerprint {
  return {
    snippetSentenceHashes: snippets.map((snippet) => writerEvidenceSentenceHashes(snippet.text)),
    researchPageHeadingHashes: [
      ...new Set(
        snippets
          .filter((snippet) => snippet.sourceName === RESEARCH_PAGE_TEXT_SOURCE)
          .flatMap((snippet) => researchPageHeadingHashes(snippet.text)),
      ),
    ].sort(),
  };
}

export function jaccardSimilarity(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 && right.size === 0) return 1;
  let shared = 0;
  for (const value of left) if (right.has(value)) shared += 1;
  return shared / (left.size + right.size - shared);
}

const sameSet = (left: readonly string[], right: readonly string[]): boolean => {
  const a = new Set(left);
  const b = new Set(right);
  return a.size === b.size && [...a].every((value) => b.has(value));
};

export function isMaterialWriterEvidenceChange(
  previous: WriterEvidenceFingerprint,
  current: WriterEvidenceFingerprint,
): boolean {
  if (!sameSet(previous.researchPageHeadingHashes, current.researchPageHeadingHashes)) return true;
  return (
    jaccardSimilarity(
      new Set(previous.snippetSentenceHashes.flat()),
      new Set(current.snippetSentenceHashes.flat()),
    ) < WRITER_MATERIAL_CHANGE_MIN_JACCARD
  );
}

/**
 * A carried-over draft cites the snippets it was written from, so each cited index is
 * moved to the current snippet sharing the most sentences with it, and dropped when none
 * shares any.
 */
export function remapUsedSnippetIndexes(
  usedSnippetIndexes: readonly number[],
  previous: readonly string[][],
  current: readonly string[][],
): number[] {
  const remapped = new Set<number>();
  for (const index of usedSnippetIndexes) {
    const sentences = new Set(previous[index] ?? []);
    if (sentences.size === 0) continue;
    let best = -1;
    let bestScore = 0;
    current.forEach((candidate, candidateIndex) => {
      const score = jaccardSimilarity(sentences, new Set(candidate));
      if (score > bestScore) {
        best = candidateIndex;
        bestScore = score;
      }
    });
    if (best >= 0) remapped.add(best);
  }
  return [...remapped].sort((a, b) => a - b);
}

export interface StoredWrittenDescriptionDerivation extends WriterEvidenceFingerprint {
  inputHash: string;
  promptHash: string;
  model: string;
  writer: string;
  rawOutput: CoverageSynthesisLLMResult;
  derivedAt: Date;
}

export interface WrittenDescriptionDerivationStore {
  find(inputHash: string): Promise<StoredWrittenDescriptionDerivation | null>;
  save(record: StoredWrittenDescriptionDerivation): Promise<void>;
}

export const mongoWrittenDescriptionDerivationStore: WrittenDescriptionDerivationStore = {
  async find(inputHash) {
    if (!mongooseConnectionWasOpened()) return null;
    return (await WrittenDescriptionDerivation.findOne({ inputHash })
      .select(
        '-_id inputHash promptHash model writer rawOutput snippetSentenceHashes researchPageHeadingHashes derivedAt',
      )
      .lean()) as StoredWrittenDescriptionDerivation | null;
  },
  async save(record) {
    await WrittenDescriptionDerivation.updateOne(
      { inputHash: record.inputHash },
      { $set: record },
      { upsert: true },
    );
  },
};

export function normalizedRawWriterOutput(raw: unknown): CoverageSynthesisLLMResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  return {
    fullDescription: typeof record.fullDescription === 'string' ? record.fullDescription : '',
    usedSnippetIndexes: Array.isArray(record.usedSnippetIndexes)
      ? record.usedSnippetIndexes.filter((index): index is number => Number.isInteger(index))
      : [],
  };
}

export function writtenDescriptionDerivationRecord(input: {
  snippets: readonly CoverageSnippet[];
  rawOutput: CoverageSynthesisLLMResult;
  inputs: WriterInputs;
  derivedAt: Date;
}): StoredWrittenDescriptionDerivation {
  return {
    inputHash: writerInputHash(input.snippets, input.inputs.model),
    promptHash: input.inputs.promptHash,
    model: input.inputs.model,
    writer: input.inputs.writer,
    rawOutput: input.rawOutput,
    ...writerEvidenceFingerprint(input.snippets),
    derivedAt: input.derivedAt,
  };
}

export interface WriterDrafting {
  draft(
    args: Parameters<CoverageSynthesisLLMFn>[0],
    onModelCall?: () => void,
  ): Promise<CoverageSynthesisLLMResult>;
}

export function writerModelThroughCache(input: {
  callLLM: CoverageSynthesisLLMFn;
  store: WrittenDescriptionDerivationStore;
  inputs?: WriterInputs;
  now?: () => Date;
}): WriterDrafting {
  const inputs = input.inputs ?? CURRENT_WRITER_INPUTS;
  const now = input.now ?? (() => new Date());
  const inFlight = new Map<string, Promise<CoverageSynthesisLLMResult>>();
  const draftOnce = async (
    inputHash: string,
    args: Parameters<CoverageSynthesisLLMFn>[0],
    onModelCall: () => void,
  ): Promise<CoverageSynthesisLLMResult> => {
    const cached = await input.store.find(inputHash);
    if (cached && cached.promptHash === inputs.promptHash) return cached.rawOutput;
    onModelCall();
    const raw = await input.callLLM(args);
    const rawOutput = normalizedRawWriterOutput(raw);
    if (!rawOutput) return raw;
    await input.store.save(
      writtenDescriptionDerivationRecord({
        snippets: args.snippets,
        rawOutput,
        inputs,
        derivedAt: now(),
      }),
    );
    return rawOutput;
  };
  return {
    draft(args, onModelCall = () => {}) {
      const inputHash = writerInputHash(args.snippets, inputs.model);
      const shared = inFlight.get(inputHash);
      if (shared) return shared;
      const pending = draftOnce(inputHash, args, onModelCall).finally(() =>
        inFlight.delete(inputHash),
      );
      inFlight.set(inputHash, pending);
      return pending;
    },
  };
}

export type WrittenDescriptionStep =
  | 'no-evidence'
  | 'cache-hit'
  | 'carried-over-unchanged'
  | 'carried-over-prompt-change'
  | 'synthesized'
  | 'refused'
  | 'cache-miss-no-call'
  | 'planned';

export interface WrittenDescriptionResolution {
  step: WrittenDescriptionStep;
  inputHash?: string;
  derivationInputHash?: string;
  writer?: string;
  decision: CoverageSynthesisDecision | null;
  modelCalled: boolean;
  refusalReasons: CoverageSynthesisRefusal[];
  refusalDetails?: CoverageSynthesisRefusalDetails;
}

export interface WrittenDescriptionSubject {
  snippets: CoverageSnippet[];
  entityName: string;
  entityType?: ResearchEntityType;
  researchAreas?: unknown;
}

export function judgeWriterDraft(
  subject: WrittenDescriptionSubject,
  rawOutput: CoverageSynthesisLLMResult,
): Promise<CoverageSynthesisDecision> {
  return coverageSynthesisDecision({
    ...subject,
    callLLM: async () => rawOutput,
    coverageWriterChecks: true,
  });
}

/**
 * A cache-hit draft that fails is refused without a call, because the model already
 * answered this exact input under this prompt; only a draft from an older prompt or an
 * earlier input earns a fresh call when it fails today's checks.
 */
export async function resolveWrittenDescription(
  input: WrittenDescriptionSubject & {
    previousInputHash?: string;
    store: WrittenDescriptionDerivationStore;
    drafting: WriterDrafting | null;
    inputs?: WriterInputs;
    /** `--cache-only`: a row the cache cannot settle is recorded, never drafted. */
    cacheOnly?: boolean;
  },
): Promise<WrittenDescriptionResolution> {
  const inputs = input.inputs ?? CURRENT_WRITER_INPUTS;
  const subject: WrittenDescriptionSubject = {
    snippets: input.snippets,
    entityName: input.entityName,
    entityType: input.entityType,
    researchAreas: input.researchAreas,
  };
  if (input.snippets.length === 0) {
    return { step: 'no-evidence', decision: null, modelCalled: false, refusalReasons: [] };
  }
  const inputHash = writerInputHash(input.snippets, inputs.model);
  const refusalReasons: CoverageSynthesisRefusal[] = [];
  const ungroundedTerms = new Set<string>();
  const judged = (decision: CoverageSynthesisDecision) => {
    if (decision.refusal) refusalReasons.push(decision.refusal);
    for (const term of decision.refusalDetails?.ungroundedTerms ?? []) ungroundedTerms.add(term);
  };
  const details = (): Pick<WrittenDescriptionResolution, 'refusalDetails'> =>
    ungroundedTerms.size > 0 ? { refusalDetails: { ungroundedTerms: [...ungroundedTerms] } } : {};
  const settled = (
    step: WrittenDescriptionStep,
    decision: CoverageSynthesisDecision,
    derivation: StoredWrittenDescriptionDerivation,
  ): WrittenDescriptionResolution => {
    judged(decision);
    return {
      step,
      inputHash,
      derivationInputHash: derivation.inputHash,
      writer: derivation.writer,
      decision,
      modelCalled: false,
      refusalReasons,
      ...details(),
    };
  };

  const cached = await input.store.find(inputHash);
  if (cached) {
    const decision = await judgeWriterDraft(subject, cached.rawOutput);
    if (cached.promptHash === inputs.promptHash) {
      return settled(decision.result ? 'cache-hit' : 'refused', decision, cached);
    }
    if (decision.result) return settled('carried-over-prompt-change', decision, cached);
    judged(decision);
  } else if (input.previousInputHash && input.previousInputHash !== inputHash) {
    const previous = await input.store.find(input.previousInputHash);
    const current = writerEvidenceFingerprint(input.snippets);
    if (previous && !isMaterialWriterEvidenceChange(previous, current)) {
      const decision = await judgeWriterDraft(subject, {
        fullDescription: previous.rawOutput.fullDescription,
        usedSnippetIndexes: remapUsedSnippetIndexes(
          previous.rawOutput.usedSnippetIndexes,
          previous.snippetSentenceHashes,
          current.snippetSentenceHashes,
        ),
      });
      if (decision.result) return settled('carried-over-unchanged', decision, previous);
      judged(decision);
    }
  }

  const drafting = input.cacheOnly ? null : input.drafting;
  if (!drafting) {
    return {
      step: input.cacheOnly ? 'cache-miss-no-call' : 'planned',
      inputHash,
      decision: null,
      modelCalled: false,
      refusalReasons,
      ...details(),
    };
  }
  let modelCalled = false;
  const decision = await coverageSynthesisDecision({
    ...subject,
    coverageWriterChecks: true,
    callLLM: (args) =>
      drafting.draft(args, () => {
        modelCalled = true;
      }),
  });
  judged(decision);
  return {
    step: decision.result ? 'synthesized' : 'refused',
    inputHash,
    derivationInputHash: inputHash,
    writer: inputs.writer,
    decision,
    modelCalled,
    refusalReasons,
    ...details(),
  };
}

export interface ImportedWriterDraft {
  slug: string;
  writer: string;
  fullDescription: string;
  usedSnippetIndexes: number[];
}

export function parseImportedWriterDrafts(value: unknown): ImportedWriterDraft[] {
  const entries = Array.isArray(value)
    ? value
    : Array.isArray((value as { entries?: unknown })?.entries)
      ? (value as { entries: unknown[] }).entries
      : null;
  if (!entries) throw new Error('--import-derivations expects a JSON array of entries');
  return entries.map((entry, position) => {
    const record = (entry ?? {}) as Record<string, unknown>;
    const slug = typeof record.slug === 'string' ? record.slug.trim() : '';
    const writer = typeof record.writer === 'string' ? record.writer.trim() : '';
    if (!slug || !writer) {
      throw new Error(`--import-derivations entry ${position} needs a slug and a writer`);
    }
    if (writer.startsWith('openai:')) {
      throw new Error(
        `--import-derivations entry ${position} names an openai writer; import only external drafts`,
      );
    }
    return {
      slug,
      writer,
      fullDescription: typeof record.fullDescription === 'string' ? record.fullDescription : '',
      usedSnippetIndexes: Array.isArray(record.usedSnippetIndexes)
        ? record.usedSnippetIndexes.filter((index): index is number => Number.isInteger(index))
        : [],
    };
  });
}

export type ImportedDraftOutcome = 'accepted' | 'refused' | 'no-evidence';

export interface ImportedDraftVerdict {
  outcome: ImportedDraftOutcome;
  inputHash?: string;
  decision: CoverageSynthesisDecision | null;
  record?: StoredWrittenDescriptionDerivation;
}

/**
 * Keyed under the writer's own model rather than the external writer's, so the writer
 * reads the draft as its cache entry; `writer` records who actually wrote it. A refused
 * draft carries its record too, because the verdict is taken again on every read and a
 * later check fix accepts it with no call.
 */
export async function judgeImportedWriterDraft(
  subject: WrittenDescriptionSubject,
  draft: ImportedWriterDraft,
  options: { inputs?: WriterInputs; derivedAt?: Date } = {},
): Promise<ImportedDraftVerdict> {
  if (subject.snippets.length === 0) return { outcome: 'no-evidence', decision: null };
  const inputs = { ...(options.inputs ?? CURRENT_WRITER_INPUTS), writer: draft.writer };
  const rawOutput = {
    fullDescription: draft.fullDescription,
    usedSnippetIndexes: draft.usedSnippetIndexes,
  };
  const decision = await judgeWriterDraft(subject, rawOutput);
  const inputHash = writerInputHash(subject.snippets, inputs.model);
  return {
    outcome: decision.result ? 'accepted' : 'refused',
    inputHash,
    decision,
    record: writtenDescriptionDerivationRecord({
      snippets: subject.snippets,
      rawOutput,
      inputs,
      derivedAt: options.derivedAt ?? new Date(),
    }),
  };
}
