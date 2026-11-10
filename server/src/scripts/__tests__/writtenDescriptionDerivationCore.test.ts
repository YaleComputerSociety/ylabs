import { describe, expect, it, vi } from 'vitest';
import type { CoverageSnippet, CoverageSynthesisLLMFn } from '../../scrapers/coverageSynthesis';
import {
  CURRENT_WRITER_INPUTS,
  WRITER_MATERIAL_CHANGE_MIN_JACCARD,
  isMaterialWriterEvidenceChange,
  judgeImportedWriterDraft,
  parseImportedWriterDrafts,
  remapUsedSnippetIndexes,
  resolveWrittenDescription,
  writerEvidenceFingerprint,
  writerInputHash,
  writerModelThroughCache,
  writtenDescriptionDerivationRecord,
  type StoredWrittenDescriptionDerivation,
  type WrittenDescriptionDerivationStore,
} from '../writtenDescriptionDerivationCore';

const PAGE_URL = 'https://reef.example.edu/research';
const PAGE_LINES = [
  'Coral Reef Recovery',
  'We study how coral reefs recover after marine heatwaves and bleaching events.',
  'Our field surveys follow coral colonies and reef fish across the Caribbean.',
  'Algae Competition',
  'We test how algae compete with coral for space on damaged reefs.',
];
const pageSnippet = (lines: string[]): CoverageSnippet => ({
  text: lines.join('\n'),
  sourceName: 'research-page-text',
  sourceUrl: PAGE_URL,
});
const PROFILE: CoverageSnippet = {
  text: 'Research examines how coral reefs recover after marine heatwaves.',
  sourceName: 'ysm-faculty-directory',
  sourceUrl: 'https://medicine.yale.edu/profile/reef-person/',
};
const SNIPPETS = [pageSnippet(PAGE_LINES), PROFILE];
const GOOD =
  'Studies how coral reefs recover after marine heatwaves and bleaching events. Field surveys follow coral colonies and reef fish across the Caribbean, and test how algae compete with coral for space on damaged reefs.';
const subject = { snippets: SNIPPETS, entityName: 'Reef Lab' };

function memoryStore(entries: StoredWrittenDescriptionDerivation[] = []) {
  const byHash = new Map(entries.map((entry) => [entry.inputHash, entry]));
  const store: WrittenDescriptionDerivationStore & {
    entries: Map<string, StoredWrittenDescriptionDerivation>;
  } = {
    entries: byHash,
    find: async (inputHash) => byHash.get(inputHash) ?? null,
    save: async (record) => {
      byHash.set(record.inputHash, record);
    },
  };
  return store;
}

const derivation = (
  snippets: CoverageSnippet[],
  fullDescription: string,
  promptHash = CURRENT_WRITER_INPUTS.promptHash,
): StoredWrittenDescriptionDerivation =>
  writtenDescriptionDerivationRecord({
    snippets,
    rawOutput: { fullDescription, usedSnippetIndexes: [0] },
    inputs: { ...CURRENT_WRITER_INPUTS, promptHash },
    derivedAt: new Date('2026-11-01T00:00:00Z'),
  });

const modelReturning = (fullDescription: string) =>
  vi.fn<CoverageSynthesisLLMFn>(async () => ({ fullDescription, usedSnippetIndexes: [0, 1] }));

describe('writerInputHash (#5537)', () => {
  it('is the same for evidence that differs only in typography and whitespace', () => {
    const retyped = [
      pageSnippet(PAGE_LINES.map((line) => line.replace(/ /g, '  ').replace(/'/g, '’'))),
      { ...PROFILE, text: PROFILE.text.replace('marine', 'Marine') },
    ];
    expect(writerInputHash(retyped)).toBe(writerInputHash(SNIPPETS));
  });

  it('changes with the evidence and the model, and never with the prompt', () => {
    expect(writerInputHash([PROFILE])).not.toBe(writerInputHash(SNIPPETS));
    expect(writerInputHash(SNIPPETS, 'another-model')).not.toBe(writerInputHash(SNIPPETS));
    const underOnePrompt = derivation(SNIPPETS, GOOD, 'prompt-a');
    const underAnother = derivation(SNIPPETS, GOOD, 'prompt-b');
    expect(underOnePrompt.inputHash).toBe(underAnother.inputHash);
    expect(underOnePrompt.promptHash).toBe('prompt-a');
    expect(underAnother.promptHash).toBe('prompt-b');
  });
});

describe('the writer cache (#5537)', () => {
  it('serves a cached draft with zero model calls and still runs every check on it', async () => {
    const store = memoryStore([derivation(SNIPPETS, GOOD)]);
    const model = modelReturning('never read');
    const resolution = await resolveWrittenDescription({
      ...subject,
      store,
      drafting: writerModelThroughCache({ callLLM: model, store }),
    });
    expect(resolution.step).toBe('cache-hit');
    expect(resolution.modelCalled).toBe(false);
    expect(model).not.toHaveBeenCalled();
    expect(resolution.decision?.result?.description).toBe(GOOD);

    const refusedStore = memoryStore([derivation(SNIPPETS, `We study coral. ${GOOD}`)]);
    const refused = await resolveWrittenDescription({
      ...subject,
      store: refusedStore,
      drafting: writerModelThroughCache({ callLLM: model, store: refusedStore }),
    });
    expect(refused.step).toBe('refused');
    expect(refused.refusalReasons).toEqual(['first-person']);
    expect(model).not.toHaveBeenCalled();
  });

  it('stores a fresh draft with openai provenance and shares one call across rows', async () => {
    const store = memoryStore();
    const model = modelReturning(GOOD);
    const drafting = writerModelThroughCache({ callLLM: model, store });
    const [first, second] = await Promise.all([
      resolveWrittenDescription({ ...subject, store, drafting }),
      resolveWrittenDescription({ ...subject, entityName: 'Reef Lab Twin', store, drafting }),
    ]);
    expect(model).toHaveBeenCalledTimes(1);
    expect([first.step, second.step]).toEqual(['synthesized', 'synthesized']);
    const stored = store.entries.get(writerInputHash(SNIPPETS));
    expect(stored?.writer).toBe(`openai:${CURRENT_WRITER_INPUTS.model}`);
    expect(stored?.rawOutput).toEqual({ fullDescription: GOOD, usedSnippetIndexes: [0, 1] });
  });
});

describe('a prompt change does not re-run passing rows (#5537)', () => {
  it('carries a passing draft over from an older prompt with no call', async () => {
    const store = memoryStore([derivation(SNIPPETS, GOOD, 'older-prompt')]);
    const model = modelReturning(GOOD);
    const resolution = await resolveWrittenDescription({
      ...subject,
      store,
      drafting: writerModelThroughCache({ callLLM: model, store }),
    });
    expect(resolution.step).toBe('carried-over-prompt-change');
    expect(model).not.toHaveBeenCalled();
  });

  it('calls the model only when the older draft fails the current checks', async () => {
    const store = memoryStore([derivation(SNIPPETS, `We study coral. ${GOOD}`, 'older-prompt')]);
    const model = modelReturning(GOOD);
    const resolution = await resolveWrittenDescription({
      ...subject,
      store,
      drafting: writerModelThroughCache({ callLLM: model, store }),
    });
    expect(model).toHaveBeenCalledTimes(1);
    expect(resolution.step).toBe('synthesized');
    expect(resolution.refusalReasons).toEqual(['first-person']);
    expect(store.entries.get(writerInputHash(SNIPPETS))?.promptHash).toBe(
      CURRENT_WRITER_INPUTS.promptHash,
    );
  });
});

describe('rewrite only on a material change (#5537)', () => {
  const sentences = (count: number) =>
    Array.from({ length: count }, (_, index) => `Coral reef survey number ${index} is recorded.`);

  it('treats a heading added or removed as material', () => {
    const before = writerEvidenceFingerprint([pageSnippet(PAGE_LINES)]);
    const headingRemoved = writerEvidenceFingerprint([
      pageSnippet(PAGE_LINES.filter((line) => line !== 'Algae Competition')),
    ]);
    const headingAdded = writerEvidenceFingerprint([
      pageSnippet([...PAGE_LINES, 'Larval Settlement']),
    ]);
    expect(isMaterialWriterEvidenceChange(before, headingRemoved)).toBe(true);
    expect(isMaterialWriterEvidenceChange(before, headingAdded)).toBe(true);
    expect(isMaterialWriterEvidenceChange(before, before)).toBe(false);
  });

  it('treats sentence overlap below the threshold as material and at it as not', () => {
    expect(WRITER_MATERIAL_CHANGE_MIN_JACCARD).toBe(0.9);
    const base = sentences(20);
    const oneOfTwentyOneNew = [...base, 'Coral reef survey extra is recorded.'];
    const threeReplaced = [...base.slice(0, 17), ...sentences(23).slice(20)];
    const fingerprint = (lines: string[]) =>
      writerEvidenceFingerprint([{ text: lines.join(' '), sourceName: 'lab-page' }]);
    expect(isMaterialWriterEvidenceChange(fingerprint(base), fingerprint(oneOfTwentyOneNew))).toBe(
      false,
    );
    expect(isMaterialWriterEvidenceChange(fingerprint(base), fingerprint(threeReplaced))).toBe(
      true,
    );
  });

  it('carries the previous draft over an immaterial change with no call, re-cited to the current snippets', async () => {
    const previousSnippets = [PROFILE, pageSnippet(PAGE_LINES)];
    const previous = writtenDescriptionDerivationRecord({
      snippets: previousSnippets,
      rawOutput: { fullDescription: GOOD, usedSnippetIndexes: [1] },
      inputs: CURRENT_WRITER_INPUTS,
      derivedAt: new Date('2026-11-01T00:00:00Z'),
    });
    const store = memoryStore([previous]);
    const model = modelReturning('never read');
    const resolution = await resolveWrittenDescription({
      ...subject,
      previousInputHash: previous.inputHash,
      store,
      drafting: writerModelThroughCache({ callLLM: model, store }),
    });
    expect(resolution.step).toBe('carried-over-unchanged');
    expect(resolution.derivationInputHash).toBe(previous.inputHash);
    expect(resolution.decision?.result?.sourceUrls).toEqual([PAGE_URL]);
    expect(model).not.toHaveBeenCalled();
    expect(store.entries.size).toBe(1);
  });

  it('calls the model after a material change', async () => {
    const previous = derivation([PROFILE], GOOD);
    const store = memoryStore([previous]);
    const model = modelReturning(GOOD);
    const resolution = await resolveWrittenDescription({
      ...subject,
      previousInputHash: previous.inputHash,
      store,
      drafting: writerModelThroughCache({ callLLM: model, store }),
    });
    expect(model).toHaveBeenCalledTimes(1);
    expect(resolution.step).toBe('synthesized');
  });

  it('moves a cited index to the snippet sharing its sentences', () => {
    expect(
      remapUsedSnippetIndexes([0, 1, 5], [['a', 'b'], ['c'], []], [['c', 'x'], ['z'], ['a', 'b']]),
    ).toEqual([0, 2]);
  });
});

describe('imported drafts (#5537)', () => {
  it('parses entries and refuses an openai writer id', () => {
    expect(
      parseImportedWriterDrafts([
        {
          slug: 'reef-lab',
          writer: 'claude-agent:1',
          fullDescription: GOOD,
          usedSnippetIndexes: [0],
        },
      ]),
    ).toEqual([
      {
        slug: 'reef-lab',
        writer: 'claude-agent:1',
        fullDescription: GOOD,
        usedSnippetIndexes: [0],
      },
    ]);
    expect(() =>
      parseImportedWriterDrafts([{ slug: 'reef-lab', writer: 'openai:gpt-5-mini' }]),
    ).toThrow(/openai writer/);
  });

  it('accepts a draft that passes every check and keys it under the writer inputs with its provenance', async () => {
    const verdict = await judgeImportedWriterDraft(subject, {
      slug: 'reef-lab',
      writer: 'claude-agent:1',
      fullDescription: GOOD,
      usedSnippetIndexes: [0],
    });
    expect(verdict.outcome).toBe('accepted');
    expect(verdict.record?.inputHash).toBe(writerInputHash(SNIPPETS));
    expect(verdict.record?.writer).toBe('claude-agent:1');
    expect(verdict.record?.promptHash).toBe(CURRENT_WRITER_INPUTS.promptHash);
  });

  it('refuses a draft that fails a check, naming it', async () => {
    const verdict = await judgeImportedWriterDraft(subject, {
      slug: 'reef-lab',
      writer: 'claude-agent:1',
      fullDescription: `${GOOD} It also models Symbiodinium bleaching.`,
      usedSnippetIndexes: [0],
    });
    expect(verdict.outcome).toBe('refused');
    expect(verdict.decision?.refusal).toBe('ungrounded-content-term');
    expect(verdict.record).toBeUndefined();
  });
});
