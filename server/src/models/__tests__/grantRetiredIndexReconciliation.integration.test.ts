import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Grant } from '../grant';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationModulePath = path.resolve(
  __dirname,
  '../../../../data-migration/DropRetiredGrantIndexes.ts',
);

type DeployedIndex = { name: string; key: Record<string, unknown>; weights?: Record<string, unknown> };

async function importIndexReconciliation(): Promise<{
  selectStaleGrantIndexes: (indexes: DeployedIndex[]) => DeployedIndex[];
}> {
  const originalMongoUrl = process.env.MONGODBURL;
  process.env.MONGODBURL = '';
  try {
    return await import(pathToFileURL(migrationModulePath).href);
  } finally {
    if (originalMongoUrl === undefined) delete process.env.MONGODBURL;
    else process.env.MONGODBURL = originalMongoUrl;
  }
}

const grants = () => mongoose.connection.collection('grants');

const deployedIndexes = async (): Promise<DeployedIndex[]> =>
  (await grants().indexes()) as unknown as DeployedIndex[];

const textIndex = (indexes: DeployedIndex[]) => indexes.find((index) => Boolean(index.weights));

describe('retired grant index reconciliation (#2145)', () => {
  let mongo: MongoMemoryServer;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60000 } });
    await mongoose.connect(mongo.getUri(), { autoIndex: false });
  }, 90000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await grants().drop().catch(() => undefined);
    await grants().insertOne({ agency: 'NIH', externalId: 'GRANT-SEED', title: 'Seed grant' });
    await grants().createIndexes([
      {
        key: { title: 'text', abstract: 'text', plainSummary: 'text', keywords: 'text' },
        name: 'title_text_abstract_text_plainSummary_text_keywords_text',
      },
      { key: { piFacultyMemberId: 1 }, name: 'piFacultyMemberId_1' },
      { key: { coPiFacultyMemberIds: 1 }, name: 'coPiFacultyMemberIds_1' },
      { key: { fiscalYear: -1 }, name: 'fiscalYear_-1' },
      { key: { researchEntityIds: 1 }, name: 'researchEntityIds_1' },
    ]);
  });

  it('cannot build the declared text index while the plainSummary text index is deployed', async () => {
    await expect(Grant.createIndexes()).rejects.toMatchObject({ code: 85 });

    expect(Object.keys(textIndex(await deployedIndexes())?.weights ?? {})).toContain('plainSummary');
  });

  it('drops only the indexes over retired paths and unblocks the declared index set', async () => {
    const { selectStaleGrantIndexes } = await importIndexReconciliation();

    const stale = selectStaleGrantIndexes(await deployedIndexes());
    expect(stale.map((index) => index.name).sort()).toEqual([
      'coPiFacultyMemberIds_1',
      'fiscalYear_-1',
      'piFacultyMemberId_1',
      'title_text_abstract_text_plainSummary_text_keywords_text',
    ]);

    for (const index of stale) await grants().dropIndex(index.name);

    await Grant.createIndexes();

    const reconciled = await deployedIndexes();
    expect(Object.keys(textIndex(reconciled)?.weights ?? {}).sort()).toEqual([
      'abstract',
      'keywords',
      'title',
    ]);
    expect(reconciled.map((index) => index.name)).toContain('researchEntityIds_1');
  });

  it('is a no-op against a collection that already matches the declared indexes', async () => {
    const { selectStaleGrantIndexes } = await importIndexReconciliation();

    for (const index of selectStaleGrantIndexes(await deployedIndexes())) {
      await grants().dropIndex(index.name);
    }
    await Grant.createIndexes();

    expect(selectStaleGrantIndexes(await deployedIndexes())).toEqual([]);
  });
});
