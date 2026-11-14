import {
  WRITTEN_DESCRIPTION_SOURCE_NAME,
  type CoverageSnippet,
} from '../scrapers/coverageSynthesis';
import type {
  CoverageSynthesisRefusal,
  CoverageSynthesisRefusalDetails,
} from '../scrapers/coverageSynthesis';
import { mapWithConcurrency } from '../scrapers/utils/mapWithConcurrency';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { storedWriterEvidenceHash } from './coverageSynthesisCore';
import {
  snippetsFromRowEvidence,
  writerServingRow,
  type WriterRowEvidence,
} from './coverageSynthesisEvidence';
import {
  judgeImportedWriterDraft,
  resolveWrittenDescription,
  type ImportedDraftOutcome,
  type ImportedWriterDraft,
  type StoredWrittenDescriptionDerivation,
  type WriterDrafting,
  type WriterInputs,
  type WrittenDescriptionDerivationStore,
  type WrittenDescriptionStep,
  type WrittenDescriptionSubject,
} from './writtenDescriptionDerivationCore';

const subjectOf = (
  row: WriterRowEvidence,
  snippets: CoverageSnippet[],
): WrittenDescriptionSubject => ({
  snippets,
  entityName: typeof row.entity.name === 'string' ? row.entity.name : '',
  entityType: row.entity.entityType,
  researchAreas: row.entity.researchAreas,
  servingRow: writerServingRow(row),
});

const isDescriptionLocked = (row: WriterRowEvidence): boolean =>
  Array.isArray(row.entity.manuallyLockedFields) &&
  row.entity.manuallyLockedFields.includes('fullDescription');

export interface WriterEvaluationRow {
  slug: string;
  step: WrittenDescriptionStep | 'fullDescription-locked' | 'missing-row' | 'error';
  snippets: CoverageSnippet[];
  inputHash?: string;
  derivationInputHash?: string;
  writer?: string;
  modelCalled: boolean;
  description: string | null;
  refusalReasons: CoverageSynthesisRefusal[];
  refusalDetails?: CoverageSynthesisRefusalDetails;
}

export interface WriterEvaluationReport {
  rows: WriterEvaluationRow[];
  modelCalls: number;
  byStep: Record<string, number>;
}

const countByStep = (rows: readonly { step: string }[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const row of [...rows].sort((a, b) => a.step.localeCompare(b.step))) {
    counts[row.step] = (counts[row.step] ?? 0) + 1;
  }
  return counts;
};

/**
 * Safety contract of the A/B mode: no observation, field, materialize, re-gate or index
 * sync; the only writes are the cache entries `drafting` makes and each call's usage record.
 */
export async function runWriterEvaluation(input: {
  rows: readonly WriterRowEvidence[];
  missingSlugs?: readonly string[];
  store: WrittenDescriptionDerivationStore;
  drafting: WriterDrafting | null;
  cacheOnly?: boolean;
  evidenceNow: Date;
  inputs?: WriterInputs;
  concurrency?: number;
  log?: (message: string) => void;
}): Promise<WriterEvaluationReport> {
  const log = input.log ?? (() => {});
  const rows: WriterEvaluationRow[] = (input.missingSlugs ?? []).map((slug) => ({
    slug,
    step: 'missing-row',
    snippets: [],
    modelCalled: false,
    description: null,
    refusalReasons: [],
  }));
  await mapWithConcurrency([...input.rows], input.concurrency ?? 4, async (row) => {
    const snippets = snippetsFromRowEvidence(row, input.evidenceNow);
    const entry: WriterEvaluationRow = {
      slug: row.slug,
      step: 'no-evidence',
      snippets,
      modelCalled: false,
      description: null,
      refusalReasons: [],
    };
    rows.push(entry);
    if (isDescriptionLocked(row)) {
      entry.step = 'fullDescription-locked';
      return;
    }
    try {
      const resolution = await resolveWrittenDescription({
        ...subjectOf(row, snippets),
        previousInputHash: storedWriterEvidenceHash(
          row.observations,
          WRITTEN_DESCRIPTION_SOURCE_NAME,
        ),
        store: input.store,
        drafting: input.drafting,
        inputs: input.inputs,
        cacheOnly: input.cacheOnly,
      });
      entry.step = resolution.step;
      entry.inputHash = resolution.inputHash;
      entry.derivationInputHash = resolution.derivationInputHash;
      entry.writer = resolution.writer;
      entry.modelCalled = resolution.modelCalled;
      entry.description = resolution.decision?.result?.description ?? null;
      entry.refusalReasons = resolution.refusalReasons;
      if (resolution.refusalDetails) entry.refusalDetails = resolution.refusalDetails;
    } catch (error) {
      entry.step = 'error';
      log(`[coverage-synthesis] ${row.slug}: ${sanitizeLogValue(error)}`);
    }
  });
  rows.sort((a, b) => a.slug.localeCompare(b.slug));
  return {
    rows,
    modelCalls: rows.filter((row) => row.modelCalled).length,
    byStep: countByStep(rows),
  };
}

export interface DerivationImportRow {
  slug: string;
  writer: string;
  outcome: ImportedDraftOutcome | 'missing-row';
  stored: boolean;
  inputHash?: string;
  existingWriter?: string;
  description: string | null;
  refusalReasons: CoverageSynthesisRefusal[];
  refusalDetails?: CoverageSynthesisRefusalDetails;
}

export interface DerivationImportReport {
  validateOnly: boolean;
  rows: DerivationImportRow[];
  byOutcome: Record<string, number>;
  stored: number;
}

/**
 * An existing entry for the same input is never replaced, so an import cannot overwrite a
 * model draft another arm stored.
 */
export async function runDerivationImport(input: {
  rows: readonly WriterRowEvidence[];
  drafts: readonly ImportedWriterDraft[];
  store: WrittenDescriptionDerivationStore;
  evidenceNow: Date;
  validateOnly: boolean;
  inputs?: WriterInputs;
  derivedAt?: Date;
}): Promise<DerivationImportReport> {
  const bySlug = new Map(input.rows.map((row) => [row.slug, row]));
  const rows: DerivationImportRow[] = [];
  for (const draft of input.drafts) {
    const row = bySlug.get(draft.slug);
    const report: DerivationImportRow = {
      slug: draft.slug,
      writer: draft.writer,
      outcome: 'missing-row',
      stored: false,
      description: null,
      refusalReasons: [],
    };
    rows.push(report);
    if (!row) continue;
    const verdict = await judgeImportedWriterDraft(
      subjectOf(row, snippetsFromRowEvidence(row, input.evidenceNow)),
      draft,
      { inputs: input.inputs, derivedAt: input.derivedAt },
    );
    report.outcome = verdict.outcome;
    report.inputHash = verdict.inputHash;
    report.description = verdict.decision?.result?.description ?? null;
    report.refusalReasons = verdict.decision?.refusal ? [verdict.decision.refusal] : [];
    if (verdict.decision?.refusalDetails) report.refusalDetails = verdict.decision.refusalDetails;
    if (!verdict.record || input.validateOnly) continue;
    const existing = await input.store.find(verdict.record.inputHash);
    if (existing) {
      report.existingWriter = existing.writer;
      continue;
    }
    await input.store.save(verdict.record);
    report.stored = true;
  }
  return {
    validateOnly: input.validateOnly,
    rows,
    byOutcome: countByStep(rows.map((row) => ({ step: row.outcome }))),
    stored: rows.filter((row) => row.stored).length,
  };
}

export type DraftSupersedeBlock =
  'missing-row' | 'no-evidence' | 'refused' | 'no-stored-draft' | 'unchanged';

export interface DraftSupersedeReport {
  slug: string;
  apply: boolean;
  reason: string;
  decidedBy: string;
  outcome: ImportedDraftOutcome | 'missing-row';
  blockedBy: DraftSupersedeBlock | null;
  stored: boolean;
  inputHash?: string;
  before: { writer: string; fullDescription: string } | null;
  after: { writer: string; fullDescription: string };
  refusalReasons: CoverageSynthesisRefusal[];
  refusalDetails?: CoverageSynthesisRefusalDetails;
}

const sameRawOutput = (
  left: StoredWrittenDescriptionDerivation['rawOutput'],
  right: StoredWrittenDescriptionDerivation['rawOutput'],
): boolean =>
  left.fullDescription === right.fullDescription &&
  JSON.stringify(left.usedSnippetIndexes) === JSON.stringify(right.usedSnippetIndexes);

export async function runDerivationSupersede(input: {
  slug: string;
  rows: readonly WriterRowEvidence[];
  drafts: readonly ImportedWriterDraft[];
  store: WrittenDescriptionDerivationStore;
  evidenceNow: Date;
  apply: boolean;
  reason: string;
  decidedBy: string;
  inputs?: WriterInputs;
  now?: Date;
}): Promise<DraftSupersedeReport> {
  const reason = input.reason.trim();
  const decidedBy = input.decidedBy.trim();
  if (!reason || !decidedBy) {
    throw new Error('--supersede-draft requires --reason and --decided-by');
  }
  if (input.drafts.length !== 1 || input.drafts[0].slug !== input.slug) {
    throw new Error(
      `--supersede-draft requires a drafts file holding exactly one entry, for the named slug (got ${input.drafts.length})`,
    );
  }
  const [draft] = input.drafts;
  const now = input.now ?? new Date();
  const report: DraftSupersedeReport = {
    slug: input.slug,
    apply: input.apply,
    reason,
    decidedBy,
    outcome: 'missing-row',
    blockedBy: 'missing-row',
    stored: false,
    before: null,
    after: { writer: draft.writer, fullDescription: draft.fullDescription },
    refusalReasons: [],
  };
  const row = input.rows.find((candidate) => candidate.slug === input.slug);
  if (!row) return report;
  const verdict = await judgeImportedWriterDraft(
    subjectOf(row, snippetsFromRowEvidence(row, input.evidenceNow)),
    draft,
    { inputs: input.inputs, derivedAt: now },
  );
  report.outcome = verdict.outcome;
  report.inputHash = verdict.inputHash;
  report.refusalReasons = verdict.decision?.refusal ? [verdict.decision.refusal] : [];
  if (verdict.decision?.refusalDetails) report.refusalDetails = verdict.decision.refusalDetails;
  const existing = verdict.inputHash ? await input.store.find(verdict.inputHash) : null;
  if (existing) {
    report.before = {
      writer: existing.writer,
      fullDescription: existing.rawOutput.fullDescription,
    };
  }
  if (verdict.outcome !== 'accepted' || !verdict.record) {
    report.blockedBy = verdict.outcome === 'no-evidence' ? 'no-evidence' : 'refused';
    return report;
  }
  if (!existing) {
    report.blockedBy = 'no-stored-draft';
    return report;
  }
  if (
    existing.writer === draft.writer &&
    sameRawOutput(existing.rawOutput, verdict.record.rawOutput)
  ) {
    report.blockedBy = 'unchanged';
    return report;
  }
  report.blockedBy = null;
  if (!input.apply) return report;
  await input.store.save({
    ...verdict.record,
    supersedes: [
      ...(existing.supersedes ?? []),
      {
        writer: existing.writer,
        rawOutput: existing.rawOutput,
        derivedAt: existing.derivedAt,
        at: now,
        reason,
        decidedBy,
      },
    ],
  });
  report.stored = true;
  return report;
}
