import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Observation } from '../../models/observation';
import { planVanityRepairWrite } from '../repairVanityHostCitations';

const VANITY_URL = 'https://synthetic-vanity.example.org/';
const DESTINATION_URL = 'https://example.edu/synthetic-lab/';

const observationOf = (value: string) =>
  Observation.create({
    entityType: 'researchEntity',
    entityKey: 'synthetic-vanity-row',
    field: 'websiteUrl',
    value,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName: 'synthetic-lane',
    sourceUrl: 'https://example.edu/synthetic-source/',
    confidence: 0.9,
    observedAt: new Date('2026-01-01T00:00:00Z'),
    superseded: false,
  });

const rowCiting = (observationId: unknown) => ({
  _id: new mongoose.Types.ObjectId(),
  slug: 'synthetic-vanity-row',
  websiteUrl: VANITY_URL,
  fieldProvenance: { websiteUrl: { sourceName: 'synthetic-lane', observationId } },
});

const repoint = { changedFields: ['websiteUrl'], websiteUrl: DESTINATION_URL };

describe('a vanity repoint keeps a stamp only for the URL its observation asserts (#6318)', () => {
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
    await mongoose.connection.db?.collection('observations').deleteMany({});
  });

  it('unsets the stamp whose observation asserts the vanity URL it replaces', async () => {
    const stamp = await observationOf(VANITY_URL);
    const write = await planVanityRepairWrite(rowCiting(stamp._id), repoint as never);
    expect(write.$set.websiteUrl).toBe(DESTINATION_URL);
    expect(write.$unset).toEqual({ 'fieldProvenance.websiteUrl': '' });
  });

  it('keeps the stamp whose observation already asserts the destination URL', async () => {
    const stamp = await observationOf(DESTINATION_URL);
    const write = await planVanityRepairWrite(rowCiting(stamp._id), repoint as never);
    expect(write.$unset).toBeUndefined();
  });
});
