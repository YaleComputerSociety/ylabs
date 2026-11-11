import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { WrittenDescriptionDerivation } from '../../models/writtenDescriptionDerivation';
import type { CoverageSynthesisLLMFn } from '../../scrapers/coverageSynthesis';
import {
  loadWriterEntitiesBySlug,
  loadWriterRowEvidence,
  parseWriterEvidenceFile,
  snippetsFromRowEvidence,
  writerEvidenceFileOf,
} from '../coverageSynthesisEvidence';
import { runDerivationImport, runWriterEvaluation } from '../coverageSynthesisEvaluate';
import {
  mongoWrittenDescriptionDerivationStore,
  writerInputHash,
  writerModelThroughCache,
} from '../writtenDescriptionDerivationCore';

const SLUG = 'reef-lab-fixture';
const PAGE_URL = 'https://reef-lab.example.org/research';
const PAGE_TEXT = [
  'Coral Reef Recovery',
  'We study how coral reefs recover after marine heatwaves and bleaching events.',
  'Our field surveys follow coral colonies and reef fish across the Caribbean.',
  'Algae Competition',
  'We test how algae compete with coral for space on damaged reefs.',
].join('\n');
const GOOD =
  'Studies how coral reefs recover after marine heatwaves and bleaching events. Field surveys follow coral colonies and reef fish across the Caribbean, and test how algae compete with coral for space on damaged reefs.';

const store = mongoWrittenDescriptionDerivationStore;

async function loadRows() {
  return loadWriterRowEvidence(await loadWriterEntitiesBySlug([SLUG]), new Set());
}

const modelReturning = (fullDescription: string) =>
  vi.fn<CoverageSynthesisLLMFn>(async () => ({ fullDescription, usedSnippetIndexes: [0] }));

describe('writer evaluate and import modes against MongoDB (#5537)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    await WrittenDescriptionDerivation.init();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities', 'written_description_derivations']) {
      await db.collection(name).deleteMany({});
    }
    await ResearchEntity.create({
      slug: SLUG,
      name: 'Reef Lab Fixture',
      kind: 'lab',
      entityType: 'LAB',
      websiteUrl: 'https://reef-lab.example.org/',
      studentVisibilityTier: 'operator_review',
      archived: false,
    });
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: SLUG,
      field: 'researchPageText',
      value: [{ url: PAGE_URL, text: PAGE_TEXT }],
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'research-page-text',
      sourceUrl: PAGE_URL,
      confidence: 0.85,
      observedAt: new Date('2026-11-01T00:00:00Z'),
      superseded: false,
    });
  });

  it('evaluates through the cache and writes no observation or field', async () => {
    const observationsBefore = await Observation.countDocuments();
    const entityBefore = await ResearchEntity.findOne({ slug: SLUG }).lean();
    const model = modelReturning(GOOD);
    const drafting = writerModelThroughCache({ callLLM: model, store });

    const first = await runWriterEvaluation({
      rows: await loadRows(),
      missingSlugs: ['absent-row'],
      store,
      drafting,
      evidenceNow: new Date(),
    });
    expect(first.rows.find((row) => row.slug === SLUG)).toMatchObject({
      step: 'synthesized',
      modelCalled: true,
      description: GOOD,
      refusalReasons: [],
    });
    expect(first.rows.find((row) => row.slug === 'absent-row')?.step).toBe('missing-row');
    expect(first.rows[1].snippets[0].sourceName).toBe('research-page-text');

    const second = await runWriterEvaluation({
      rows: await loadRows(),
      store,
      drafting,
      evidenceNow: new Date(),
    });
    expect(second.rows[0]).toMatchObject({ step: 'cache-hit', modelCalled: false });
    expect(second.modelCalls).toBe(0);
    expect(model).toHaveBeenCalledTimes(1);

    expect(await Observation.countDocuments()).toBe(observationsBefore);
    expect(await ResearchEntity.findOne({ slug: SLUG }).lean()).toEqual(entityBefore);
    const cached = await WrittenDescriptionDerivation.find().lean();
    expect(cached).toHaveLength(1);
    expect(cached[0]).toMatchObject({
      writer: 'openai:gpt-5-mini',
      inputHash: first.rows[1].inputHash,
    });
  });

  it('gives the same inputHash from one evidence file on every run', async () => {
    const captured = writerEvidenceFileOf(
      await loadRows(),
      new Date('2026-11-10T00:00:00Z'),
      'x/Development',
    );
    const reread = () => parseWriterEvidenceFile(JSON.parse(JSON.stringify(captured)));
    await Observation.updateOne({ field: 'researchPageText' }, { $set: { value: [] } });

    const hashes = [reread(), reread()].map((file) =>
      writerInputHash(snippetsFromRowEvidence(file.rows[0], new Date(file.capturedAt))),
    );
    expect(hashes[0]).toBe(hashes[1]);
    const live = await loadRows();
    expect(writerInputHash(snippetsFromRowEvidence(live[0], new Date()))).not.toBe(hashes[0]);

    const model = modelReturning(GOOD);
    const fromFile = await runWriterEvaluation({
      rows: reread().rows,
      store,
      drafting: writerModelThroughCache({ callLLM: model, store }),
      evidenceNow: new Date(captured.capturedAt),
    });
    expect(fromFile.rows[0].inputHash).toBe(hashes[0]);
    expect(fromFile.rows[0].step).toBe('synthesized');
  });

  it('imports an accepted external draft with its provenance and no observation', async () => {
    const observationsBefore = await Observation.countDocuments();
    const report = await runDerivationImport({
      rows: await loadRows(),
      drafts: [
        { slug: SLUG, writer: 'claude-agent:1', fullDescription: GOOD, usedSnippetIndexes: [0] },
      ],
      store,
      evidenceNow: new Date(),
      validateOnly: false,
    });
    expect(report.rows[0]).toMatchObject({ outcome: 'accepted', stored: true });
    const cached = await WrittenDescriptionDerivation.findOne({
      inputHash: report.rows[0].inputHash,
    }).lean();
    expect(cached).toMatchObject({
      writer: 'claude-agent:1',
      rawOutput: { fullDescription: GOOD },
    });
    expect(await Observation.countDocuments()).toBe(observationsBefore);

    const model = modelReturning('never read');
    const evaluated = await runWriterEvaluation({
      rows: await loadRows(),
      store,
      drafting: writerModelThroughCache({ callLLM: model, store }),
      evidenceNow: new Date(),
    });
    expect(evaluated.rows[0]).toMatchObject({ step: 'cache-hit', writer: 'claude-agent:1' });
    expect(model).not.toHaveBeenCalled();
  });

  it('stores a refused external draft with its provenance, judged again on read', async () => {
    const report = await runDerivationImport({
      rows: await loadRows(),
      drafts: [
        {
          slug: SLUG,
          writer: 'claude-agent:1',
          fullDescription: `We study coral. ${GOOD}`,
          usedSnippetIndexes: [0],
        },
      ],
      store,
      evidenceNow: new Date(),
      validateOnly: false,
    });
    expect(report.rows[0]).toMatchObject({
      outcome: 'refused',
      stored: true,
      refusalReasons: ['first-person'],
    });
    const stored = await WrittenDescriptionDerivation.findOne().lean();
    expect(stored).toMatchObject({
      writer: 'claude-agent:1',
      rawOutput: { fullDescription: `We study coral. ${GOOD}` },
    });
    const model = modelReturning('never read');
    const evaluated = await runWriterEvaluation({
      rows: await loadRows(),
      store,
      drafting: writerModelThroughCache({ callLLM: model, store }),
      evidenceNow: new Date(),
    });
    expect(evaluated.rows[0]).toMatchObject({ step: 'refused', refusalReasons: ['first-person'] });
    expect(model).not.toHaveBeenCalled();
  });

  it('lists the offending terms of an ungrounded refusal in the import and evaluate reports', async () => {
    const invented = `${GOOD} It also studies malaria transmission.`;
    const imported = await runDerivationImport({
      rows: await loadRows(),
      drafts: [
        {
          slug: SLUG,
          writer: 'claude-agent:1',
          fullDescription: invented,
          usedSnippetIndexes: [0],
        },
      ],
      store,
      evidenceNow: new Date(),
      validateOnly: true,
    });
    expect(imported.rows[0]).toMatchObject({
      outcome: 'refused',
      refusalReasons: ['ungrounded-content-term'],
      refusalDetails: { ungroundedTerms: ['malaria'] },
    });

    const evaluated = await runWriterEvaluation({
      rows: await loadRows(),
      store,
      drafting: writerModelThroughCache({ callLLM: modelReturning(invented), store }),
      evidenceNow: new Date(),
    });
    expect(evaluated.rows[0]).toMatchObject({
      step: 'refused',
      refusalDetails: { ungroundedTerms: ['malaria'] },
    });
  });

  it('validates without writing anything when asked to validate only', async () => {
    const observationsBefore = await Observation.countDocuments();
    const report = await runDerivationImport({
      rows: await loadRows(),
      drafts: [
        { slug: SLUG, writer: 'claude-agent:1', fullDescription: GOOD, usedSnippetIndexes: [0] },
      ],
      store,
      evidenceNow: new Date(),
      validateOnly: true,
    });
    expect(report.rows[0]).toMatchObject({ outcome: 'accepted', stored: false });
    expect(await WrittenDescriptionDerivation.countDocuments()).toBe(0);
    expect(await Observation.countDocuments()).toBe(observationsBefore);
  });
});
