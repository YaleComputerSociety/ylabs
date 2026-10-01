import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { mongoOptions } from '../../db/connections';
import { ARCHIVE_ATTRIBUTION_FIELDS, attributedArchiveSet } from '../entityArchival';
import { ResearchEntityRelationship } from '../researchEntityRelationship';
import { Signal } from '../signal';

const PROBE_REASON = 'probe:archive-attribution';

describe('signals and relationship edges keep who archived them through a model write (#3935)', () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri(), mongoOptions);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await server?.stop();
  });

  it.each([
    ['Signal', Signal],
    ['ResearchEntityRelationship', ResearchEntityRelationship],
  ])('%s models both attribution fields', (_name, model) => {
    for (const field of ARCHIVE_ATTRIBUTION_FIELDS) {
      expect(model.schema.paths[field]).toBeDefined();
    }
  });

  it.each([
    ['signals', Signal, { type: 'CONTACT_INSTRUCTIONS_EXIST', archived: false }],
    [
      'research_entity_relationships',
      ResearchEntityRelationship,
      {
        sourceResearchEntityId: new mongoose.Types.ObjectId(),
        targetResearchEntityId: new mongoose.Types.ObjectId(),
        relationshipType: 'AFFILIATED_LAB',
        archived: false,
      },
    ],
  ])(
    'an archive of a %s row through its model stores the reason and time',
    async (collection, model, row) => {
      const { insertedId } = await mongoose.connection
        .db!.collection(collection)
        .insertOne({ ...row });

      await (model as mongoose.Model<unknown>).updateOne(
        { _id: insertedId },
        { $set: attributedArchiveSet(PROBE_REASON) },
      );

      const stored = await mongoose.connection
        .db!.collection(collection)
        .findOne({ _id: insertedId });
      expect(stored?.archived).toBe(true);
      expect(stored?.archivedReason).toBe(PROBE_REASON);
      expect(stored?.archivedAt).toBeInstanceOf(Date);
    },
  );

  it('refuses an archive with no reason rather than writing an unattributable one', () => {
    expect(() => attributedArchiveSet('  ')).toThrow(/archivedReason/);
  });
});
