import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Observation } from '../../models/observation';
import { WrittenDescriptionDerivation } from '../../models/writtenDescriptionDerivation';
import { runDerivationImport } from '../coverageSynthesisEvaluate';
import { snippetsFromRowEvidence, type WriterRowEvidence } from '../coverageSynthesisEvidence';
import {
  carriedOverWrites,
  liveWrittenBody,
  parseCoverageSynthesisArgs,
  writerModelClientFor,
  writerWritesFor,
} from '../coverageSynthesisCore';
import {
  CURRENT_WRITER_INPUTS,
  mongoWrittenDescriptionDerivationStore,
  resolveWrittenDescription,
  writerModelThroughCache,
} from '../writtenDescriptionDerivationCore';

const EVIDENCE_AT = new Date('2026-11-01T00:00:00Z');
const PAGE_TEXT = [
  'Coral Reef Recovery',
  'The lab studies how coral reefs recover after marine heatwaves and bleaching events.',
  'Field surveys follow coral colonies and reef fish across the Caribbean.',
].join('\n');
const SERVED_TEXT = 'Studies coral reef recovery after marine heatwaves.';

const row: WriterRowEvidence = {
  slug: 'reef-lab-refused-import-fixture',
  entity: { slug: 'reef-lab-refused-import-fixture', name: 'Reef Lab', entityType: 'LAB' },
  observations: [
    {
      field: 'researchPageText',
      value: [{ url: 'https://reef.example.org/research', text: PAGE_TEXT }],
      sourceName: 'research-page-text',
      sourceUrl: 'https://reef.example.org/research',
      observedAt: EVIDENCE_AT,
    },
    {
      field: 'fullDescription',
      value: SERVED_TEXT,
      sourceName: 'yale-research-official',
      sourceUrl: 'https://reef.example.org/',
      observedAt: EVIDENCE_AT,
    },
  ],
  mergedInObservations: [],
};

describe('the writer cache settles imported drafts without a model call (#5537)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    await WrittenDescriptionDerivation.deleteMany({});
    await Observation.deleteMany({});
  });

  const importEmptyDraft = () =>
    runDerivationImport({
      rows: [row],
      drafts: [
        {
          slug: row.slug,
          writer: 'claude-agent:seed-fixture',
          fullDescription: '',
          usedSnippetIndexes: [],
        },
      ],
      store: mongoWrittenDescriptionDerivationStore,
      evidenceNow: EVIDENCE_AT,
      validateOnly: false,
    });

  const resolve = (
    drafting: ReturnType<typeof writerModelThroughCache> | null,
    inputs = CURRENT_WRITER_INPUTS,
    cacheOnly = false,
  ) =>
    resolveWrittenDescription({
      snippets: snippetsFromRowEvidence(row, EVIDENCE_AT),
      entityName: 'Reef Lab',
      entityType: 'LAB',
      servingRow: null,
      previousInputHash: 'an-earlier-input',
      store: mongoWrittenDescriptionDerivationStore,
      drafting,
      inputs,
      cacheOnly,
    });

  it('stores the empty draft, then applies it with no model call and no body written', async () => {
    const imported = await importEmptyDraft();
    expect(imported.rows[0]).toMatchObject({ outcome: 'refused', stored: true });
    expect(imported.rows[0].refusalReasons).toEqual(['empty-description']);

    const model = vi.fn(async () => ({
      fullDescription: 'Studies reefs.',
      usedSnippetIndexes: [0],
    }));
    const resolution = await resolve(
      writerModelThroughCache({ callLLM: model, store: mongoWrittenDescriptionDerivationStore }),
    );
    expect(resolution.step).toBe('refused');
    expect(resolution.modelCalled).toBe(false);
    expect(model).not.toHaveBeenCalled();

    const writes = carriedOverWrites(writerWritesFor('synthesize', resolution.decision), {
      carriedOver: false,
      liveBody: liveWrittenBody(row.observations, 'coverage-synthesis-llm'),
      description: undefined,
    });
    expect(writes.writeBody).toBe(false);
    expect(await Observation.countDocuments({ field: 'fullDescription' })).toBe(0);
    expect(liveWrittenBody(row.observations, 'coverage-synthesis-llm')).toBeUndefined();
  });

  it('plans no call in a dry run', async () => {
    await importEmptyDraft();
    const resolution = await resolve(null);
    expect(resolution.step).toBe('refused');
    expect(resolution.step).not.toBe('planned');
  });

  it('re-calls the model only under a different prompt', async () => {
    await importEmptyDraft();
    const laterPrompt = { ...CURRENT_WRITER_INPUTS, promptHash: 'a-later-prompt' };
    const model = vi.fn(async () => ({
      fullDescription: 'Studies reefs.',
      usedSnippetIndexes: [0],
    }));
    const resolution = await resolve(
      writerModelThroughCache({
        callLLM: model,
        store: mongoWrittenDescriptionDerivationStore,
        inputs: laterPrompt,
      }),
      laterPrompt,
    );
    expect(resolution.modelCalled).toBe(true);
    expect(model).toHaveBeenCalledTimes(1);
  });

  const ACCEPTED =
    'Studies how coral reefs recover after marine heatwaves and bleaching events, with field surveys of coral colonies and reef fish across the Caribbean.';
  const importDraft = (fullDescription: string) =>
    runDerivationImport({
      rows: [row],
      drafts: [
        {
          slug: row.slug,
          writer: 'claude-agent:seed-fixture',
          fullDescription,
          usedSnippetIndexes: [0],
        },
      ],
      store: mongoWrittenDescriptionDerivationStore,
      evidenceNow: EVIDENCE_AT,
      validateOnly: false,
    });
  const spyDrafting = () => {
    const model = vi.fn(async () => ({ fullDescription: ACCEPTED, usedSnippetIndexes: [0] }));
    return {
      model,
      drafting: writerModelThroughCache({
        callLLM: model,
        store: mongoWrittenDescriptionDerivationStore,
      }),
    };
  };

  it('builds no model client under --cache-only, with the key unset', () => {
    const args = parseCoverageSynthesisArgs(['--cache-only', '--apply', '--all']);
    expect(args.cacheOnly).toBe(true);
    const create = vi.fn();
    expect(
      writerModelClientFor({
        apply: args.apply && !args.reinstateRetiredBodies && !args.cacheOnly,
        apiKey: undefined,
        create,
      }),
    ).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('writes a cached accepted draft under --cache-only', async () => {
    const imported = await importDraft(ACCEPTED);
    expect(imported.rows[0]).toMatchObject({ outcome: 'accepted', stored: true });
    const { model, drafting } = spyDrafting();
    const resolution = await resolve(drafting, CURRENT_WRITER_INPUTS, true);
    expect(resolution.step).toBe('cache-hit');
    expect(model).not.toHaveBeenCalled();
    expect(writerWritesFor('synthesize', resolution.decision).writeBody).toBe(true);
  });

  it('records a cache miss with no call, no body and no retire under --cache-only', async () => {
    const { model, drafting } = spyDrafting();
    const resolution = await resolve(drafting, CURRENT_WRITER_INPUTS, true);
    expect(resolution.step).toBe('cache-miss-no-call');
    expect(resolution.decision).toBeNull();
    expect(resolution.modelCalled).toBe(false);
    expect(model).not.toHaveBeenCalled();
    expect(await WrittenDescriptionDerivation.countDocuments({})).toBe(0);
  });

  it('records a prompt-change re-run as a cache miss under --cache-only', async () => {
    await importEmptyDraft();
    const laterPrompt = { ...CURRENT_WRITER_INPUTS, promptHash: 'a-later-prompt' };
    const model = vi.fn(async () => ({ fullDescription: ACCEPTED, usedSnippetIndexes: [0] }));
    const resolution = await resolve(
      writerModelThroughCache({
        callLLM: model,
        store: mongoWrittenDescriptionDerivationStore,
        inputs: laterPrompt,
      }),
      laterPrompt,
      true,
    );
    expect(resolution.step).toBe('cache-miss-no-call');
    expect(model).not.toHaveBeenCalled();
  });

  it('still drafts a cache miss without --cache-only', async () => {
    const { model, drafting } = spyDrafting();
    const resolution = await resolve(drafting);
    expect(resolution.step).toBe('synthesized');
    expect(model).toHaveBeenCalledTimes(1);
  });
});
