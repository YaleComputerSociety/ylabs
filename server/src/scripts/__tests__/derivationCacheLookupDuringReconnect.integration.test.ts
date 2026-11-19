import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mongoCardSynthesisDerivationStore } from '../../scrapers/cardSynthesisDerivation';
import { createDescriptionCardJudge } from '../../scrapers/descriptionCardRefreshGuard';
import { mongoWrittenDescriptionDerivationStore } from '../writtenDescriptionDerivationCore';

const WRITER_RECORD = {
  inputHash: 'writer-hash-reconnect-fixture',
  promptHash: 'prompt',
  model: 'model',
  writer: 'claude-agent:reconnect-fixture',
  rawOutput: { fullDescription: 'Studies reef recovery.', usedSnippetIndexes: [0] },
  snippetSentenceHashes: [],
  researchPageHeadingHashes: [],
  derivedAt: new Date('2026-11-11T00:00:00Z'),
};
const CARD_RECORD = {
  inputHash: 'card-hash-reconnect-fixture',
  promptHash: 'prompt',
  model: 'model',
  writer: 'claude-agent:reconnect-fixture',
  rawCards: ['Studies reef recovery.'],
  derivedAt: new Date('2026-11-11T00:00:00Z'),
};

describe('a cache read during a dropped connection is an error, never a miss (#5537)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  it('answers no entry in a process that never opened a connection', async () => {
    expect(await mongoWrittenDescriptionDerivationStore.find(WRITER_RECORD.inputHash)).toBeNull();
    expect(await mongoCardSynthesisDerivationStore.find(CARD_RECORD.inputHash)).toBeNull();
  });

  it('finds the stored entries while connected', async () => {
    await mongoose.connect(replSet.getUri());
    await mongoWrittenDescriptionDerivationStore.save(WRITER_RECORD);
    await mongoCardSynthesisDerivationStore.save(CARD_RECORD);
    expect(
      (await mongoWrittenDescriptionDerivationStore.find(WRITER_RECORD.inputHash))?.writer,
    ).toBe(WRITER_RECORD.writer);
    expect((await mongoCardSynthesisDerivationStore.find(CARD_RECORD.inputHash))?.writer).toBe(
      CARD_RECORD.writer,
    );
  });

  it('throws rather than reporting a miss while the connection is down', async () => {
    await mongoose.disconnect();
    await expect(
      mongoWrittenDescriptionDerivationStore.find(WRITER_RECORD.inputHash),
    ).rejects.toThrow();
    await expect(mongoCardSynthesisDerivationStore.find(CARD_RECORD.inputHash)).rejects.toThrow();
  });

  it('throws rather than waving a description refresh through while the connection is down', async () => {
    const judge = createDescriptionCardJudge();
    await expect(
      judge(
        { entityType: 'researchEntity', entityKey: 'reef-lab-reconnect-fixture' },
        { fullDescription: 'Studies reef recovery.', shortDescription: 'Studies reefs.' },
        {},
      ),
    ).rejects.toThrow();
  });

  it('throws rather than reporting a miss while the connection is reopening', async () => {
    const reopening = mongoose.connect(replSet.getUri());
    await expect(
      mongoWrittenDescriptionDerivationStore.find(WRITER_RECORD.inputHash),
    ).rejects.toThrow();
    await reopening;
    expect(
      (await mongoWrittenDescriptionDerivationStore.find(WRITER_RECORD.inputHash))?.writer,
    ).toBe(WRITER_RECORD.writer);
  });
});
