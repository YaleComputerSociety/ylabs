import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { mongoOptions } from '../../db/connections';
import { ARCHIVE_ATTRIBUTION_FIELDS, attributedArchiveSet } from '../entityArchival';
import { ResearchEntityRelationship } from '../researchEntityRelationship';
import { Signal } from '../signal';

const PROBE_REASON = 'probe:archive-attribution';

const rows: Array<[string, unknown, () => Record<string, unknown>]> = [
  ['signals', Signal, () => ({ type: 'CONTACT_INSTRUCTIONS_EXIST', archived: false })],
  [
    'research_entity_relationships',
    ResearchEntityRelationship,
    () => ({
      sourceResearchEntityId: new mongoose.Types.ObjectId(),
      targetResearchEntityId: new mongoose.Types.ObjectId(),
      relationshipType: 'AFFILIATED_LAB',
      archived: false,
    }),
  ],
];

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

  it.each(rows)(
    'an archive of a %s row through its model stores the reason and time',
    async (collection, model, row) => {
      const { insertedId } = await mongoose.connection.db!.collection(collection).insertOne(row());

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

  const unattributedArchives: Array<
    [string, (model: mongoose.Model<unknown>, _id: unknown) => Promise<unknown>]
  > = [
    ['updateOne', (model, _id) => model.updateOne({ _id }, { $set: { archived: true } }).exec()],
    [
      'updateMany',
      (model, _id) =>
        model.updateMany({ _id }, { $set: { archived: true, archivedReason: ' ' } }).exec(),
    ],
    [
      'findOneAndUpdate',
      (model, _id) => model.findOneAndUpdate({ _id }, { archived: true }).exec(),
    ],
    [
      'findByIdAndUpdate',
      (model, _id) => model.findByIdAndUpdate(_id, { $set: { archived: true } }).exec(),
    ],
  ];

  describe.each(rows)('%s', (collection, model, row) => {
    it.each(unattributedArchives)(
      'refuses an unattributed archive through %s and leaves the row live',
      async (_method, archive) => {
        const { insertedId } = await mongoose.connection
          .db!.collection(collection)
          .insertOne(row());

        await expect(archive(model as mongoose.Model<unknown>, insertedId)).rejects.toThrow(
          /archivedReason/,
        );

        const stored = await mongoose.connection
          .db!.collection(collection)
          .findOne({ _id: insertedId });
        expect(stored?.archived).toBe(false);
      },
    );

    it('withdraws the old attribution when a write revives the row', async () => {
      const { insertedId } = await mongoose.connection
        .db!.collection(collection)
        .insertOne({ ...row(), ...attributedArchiveSet(PROBE_REASON) });

      await (model as mongoose.Model<unknown>).updateOne(
        { _id: insertedId },
        { $set: { archived: false } },
      );

      const stored = await mongoose.connection
        .db!.collection(collection)
        .findOne({ _id: insertedId });
      expect(stored?.archived).toBe(false);
      expect(stored).not.toHaveProperty('archivedReason');
      expect(stored).not.toHaveProperty('archivedAt');
    });
  });
});
