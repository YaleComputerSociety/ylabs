import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ResearchEntity } from '../researchEntity';
import {
  DERIVED_RESEARCH_AREA_SOURCE_NAME,
  UnbackedFieldProvenanceWriteError,
  fieldProvenanceEntryIsBacked,
  fieldProvenanceEntryNamesALaneWithoutEvidence,
  unbackedFieldProvenanceWritePaths,
} from '../fieldProvenanceBacking';

const observationId = () => new mongoose.Types.ObjectId();
const unbacked = { sourceName: 'synthetic-repair-lane', sourceUrl: 'https://example.org/page' };
const backed = () => ({
  sourceName: 'synthetic-lane',
  sourceUrl: 'https://example.org/page',
  observationId: observationId(),
});

describe('the fieldProvenance backing predicates', () => {
  it('treats an entry as backed only by an observationId or a registered derivation', () => {
    expect(fieldProvenanceEntryIsBacked(backed())).toBe(true);
    expect(fieldProvenanceEntryIsBacked({ sourceName: DERIVED_RESEARCH_AREA_SOURCE_NAME })).toBe(
      true,
    );
    expect(fieldProvenanceEntryIsBacked(unbacked)).toBe(false);
    expect(fieldProvenanceEntryIsBacked({ ...unbacked, sourceId: observationId() })).toBe(false);
  });

  it('reads a stored bare sourceId or observationId as history rather than as an unbacked lane', () => {
    expect(fieldProvenanceEntryNamesALaneWithoutEvidence(unbacked)).toBe(true);
    expect(
      fieldProvenanceEntryNamesALaneWithoutEvidence({ ...unbacked, sourceId: observationId() }),
    ).toBe(false);
    expect(fieldProvenanceEntryNamesALaneWithoutEvidence(backed())).toBe(false);
    expect(
      fieldProvenanceEntryNamesALaneWithoutEvidence({
        sourceName: DERIVED_RESEARCH_AREA_SOURCE_NAME,
      }),
    ).toBe(false);
    expect(
      fieldProvenanceEntryNamesALaneWithoutEvidence({ sourceUrl: 'https://example.org' }),
    ).toBe(false);
  });

  it('finds every authoring form in an update and ignores the ones that author nothing', () => {
    expect(
      unbackedFieldProvenanceWritePaths({
        $set: {
          'fieldProvenance.school': unbacked,
          'fieldProvenance.name': backed(),
          'fieldProvenance.departments.sourceUrl': 'https://example.org/moved',
          'fieldProvenance.entityType.sourceName': 'synthetic-repair-lane',
        },
        $setOnInsert: { fieldProvenance: { fullDescription: unbacked, websiteUrl: backed() } },
        $unset: { 'fieldProvenance.researchAreas': '' },
        'fieldProvenance.shortDescription': unbacked,
      }),
    ).toEqual([
      'fieldProvenance.shortDescription',
      'fieldProvenance.school',
      'fieldProvenance.entityType.sourceName',
      'fieldProvenance.fullDescription',
    ]);
    expect(
      unbackedFieldProvenanceWritePaths([{ $set: { 'fieldProvenance.name': unbacked } }]),
    ).toEqual(['fieldProvenance.name']);
    expect(unbackedFieldProvenanceWritePaths({ $set: { 'fieldProvenance.name': null } })).toEqual(
      [],
    );
  });
});

describe('the ResearchEntity model refuses an unbacked fieldProvenance write (#3769)', () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await server.stop();
  });

  beforeEach(async () => {
    await mongoose.connection.db!.collection('research_entities').deleteMany({});
  });

  const seed = async (slug: string, fieldProvenance: Record<string, unknown> = {}) => {
    await mongoose.connection.db!.collection('research_entities').insertOne({
      slug,
      name: 'Synthetic Research',
      fieldProvenance,
    });
    return (await ResearchEntity.findOne({ slug }))!;
  };

  const storedProvenance = async (slug: string) =>
    ((await mongoose.connection.db!.collection('research_entities').findOne({ slug }))
      ?.fieldProvenance ?? {}) as Record<string, unknown>;

  it('refuses updateOne, updateMany, findOneAndUpdate and replaceOne', async () => {
    await seed('synthetic-a');
    await expect(
      ResearchEntity.updateOne(
        { slug: 'synthetic-a' },
        { $set: { 'fieldProvenance.school': unbacked } },
      ),
    ).rejects.toBeInstanceOf(UnbackedFieldProvenanceWriteError);
    await expect(
      ResearchEntity.updateMany({}, { 'fieldProvenance.school': unbacked }),
    ).rejects.toBeInstanceOf(UnbackedFieldProvenanceWriteError);
    await expect(
      ResearchEntity.findOneAndUpdate(
        { slug: 'synthetic-a' },
        { $set: { fieldProvenance: { name: unbacked } } },
      ),
    ).rejects.toBeInstanceOf(UnbackedFieldProvenanceWriteError);
    await expect(
      ResearchEntity.replaceOne(
        { slug: 'synthetic-a' },
        { slug: 'synthetic-a', name: 'Synthetic Research', fieldProvenance: { name: unbacked } },
      ),
    ).rejects.toBeInstanceOf(UnbackedFieldProvenanceWriteError);
    expect(await storedProvenance('synthetic-a')).toEqual({});
  });

  it('refuses create, save, insertMany and bulkWrite', async () => {
    await expect(
      ResearchEntity.create({
        slug: 'synthetic-b',
        name: 'Synthetic',
        fieldProvenance: { name: unbacked },
      }),
    ).rejects.toBeInstanceOf(UnbackedFieldProvenanceWriteError);
    await expect(
      ResearchEntity.insertMany([
        { slug: 'synthetic-c', name: 'Synthetic', fieldProvenance: { name: unbacked } },
      ]),
    ).rejects.toBeInstanceOf(UnbackedFieldProvenanceWriteError);
    const doc = await seed('synthetic-d');
    doc.set('fieldProvenance.school', unbacked);
    await expect(doc.save()).rejects.toBeInstanceOf(UnbackedFieldProvenanceWriteError);
    await expect(
      ResearchEntity.bulkWrite([
        {
          updateOne: {
            filter: { slug: 'synthetic-d' },
            update: { $set: { 'fieldProvenance.school': unbacked } },
          },
        },
      ]),
    ).rejects.toBeInstanceOf(UnbackedFieldProvenanceWriteError);
    expect(
      await ResearchEntity.countDocuments({ slug: { $in: ['synthetic-b', 'synthetic-c'] } }),
    ).toBe(0);
    expect(await storedProvenance('synthetic-d')).toEqual({});
  });

  it('persists a backed entry, a registered derivation, a repoint and an unset', async () => {
    await seed('synthetic-e', {
      departments: { sourceName: 'synthetic-lane', observationId: observationId() },
    });
    const entry = backed();
    await ResearchEntity.updateOne(
      { slug: 'synthetic-e' },
      {
        $set: {
          'fieldProvenance.school': entry,
          'fieldProvenance.researchAreas': {
            sourceName: DERIVED_RESEARCH_AREA_SOURCE_NAME,
            sourceUrl: '',
          },
          'fieldProvenance.departments.sourceUrl': 'https://example.org/moved',
        },
      },
    );
    const stored = await storedProvenance('synthetic-e');
    expect(String((stored.school as { observationId: unknown }).observationId)).toBe(
      String(entry.observationId),
    );
    expect((stored.researchAreas as { sourceName: string }).sourceName).toBe(
      DERIVED_RESEARCH_AREA_SOURCE_NAME,
    );
    expect((stored.departments as { sourceUrl: string }).sourceUrl).toBe(
      'https://example.org/moved',
    );
    await ResearchEntity.updateOne(
      { slug: 'synthetic-e' },
      { $unset: { 'fieldProvenance.school': '' } },
    );
    expect((await storedProvenance('synthetic-e')).school).toBeUndefined();
  });

  it('lets a loaded row carrying legacy unbacked history save a change to another field', async () => {
    const doc = await seed('synthetic-f', { entityType: unbacked });
    doc.set('name', 'Renamed Synthetic Research');
    await doc.save();
    expect((await storedProvenance('synthetic-f')).entityType).toMatchObject(unbacked);
  });
});
