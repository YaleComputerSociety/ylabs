import {
  WRITTEN_DESCRIPTION_SOURCE_NAME,
  type CoverageSnippet,
} from '../scrapers/coverageSynthesis';
import type { CoverageSynthesisRefusal } from '../scrapers/coverageSynthesis';
import { mapWithConcurrency } from '../scrapers/utils/mapWithConcurrency';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { storedWriterEvidenceHash } from './coverageSynthesisCore';
import { snippetsFromRowEvidence, type WriterRowEvidence } from './coverageSynthesisEvidence';
import {
  judgeImportedWriterDraft,
  resolveWrittenDescription,
  type ImportedDraftOutcome,
  type ImportedWriterDraft,
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
      });
      entry.step = resolution.step;
      entry.inputHash = resolution.inputHash;
      entry.derivationInputHash = resolution.derivationInputHash;
      entry.writer = resolution.writer;
      entry.modelCalled = resolution.modelCalled;
      entry.description = resolution.decision?.result?.description ?? null;
      entry.refusalReasons = resolution.refusalReasons;
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
  outcome: ImportedDraftOutcome | 'missing-row' | 'already-cached';
  stored: boolean;
  inputHash?: string;
  existingWriter?: string;
  description: string | null;
  refusalReasons: CoverageSynthesisRefusal[];
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
    if (verdict.outcome !== 'accepted' || !verdict.record || input.validateOnly) continue;
    const existing = await input.store.find(verdict.record.inputHash);
    if (existing) {
      report.outcome = 'already-cached';
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
