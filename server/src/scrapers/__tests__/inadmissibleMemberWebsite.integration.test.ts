import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntity: vi.fn().mockResolvedValue(undefined),
    deleteFromIndex: vi.fn().mockResolvedValue(undefined),
  };
});

import { Observation } from '../../models/observation';
import { Researcher } from '../../models/researcher';
import { materializeEntity } from '../entityMaterializer';

const OWNER_PAGE = 'https://medicine.yale.edu/profile/fixture-quillsby-person/';
const PATIENT_CARE_PAGE = 'https://medicine.example.edu/fixturedept/clinical-service/fixture/';
const PERSONAL_SITE = 'https://fixtureperson.example.org/';

describe("a lead's member website never stores a patient-care, course or posting page (#5376)", () => {
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
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'researchers', 'accounts']) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedUser = async (entityKey: string, fields: Record<string, unknown>) => {
    for (const [field, value] of Object.entries(fields)) {
      await Observation.create({
        entityType: 'user',
        entityKey,
        sourceId: new mongoose.Types.ObjectId(),
        sourceName: 'dept-faculty-roster',
        sourceUrl: 'https://medicine.example.edu/fixturedept/people/',
        confidence: 0.7,
        observedAt: new Date('2026-03-01T00:00:00Z'),
        superseded: false,
        field,
        value,
      });
    }
  };

  const person = (websiteUrl: string) =>
    Researcher.create({
      displayName: 'Fixture Quillsby',
      profile: { title: 'Professor of Fixtures', websiteUrl },
      profileLinks: [
        {
          kind: 'YALE_OFFICIAL',
          purpose: 'PRIMARY_IDENTITY',
          url: OWNER_PAGE,
          verifiedAt: new Date('2026-01-01T00:00:00Z'),
          healthStatus: 'UNKNOWN',
        },
      ],
      status: 'UNKNOWN',
      archived: false,
    });

  const storedWebsite = async (id: unknown) =>
    (await Researcher.findById(id).lean<{ profile?: { websiteUrl?: string } }>())?.profile
      ?.websiteUrl;

  const materialize = (website: string) =>
    seedUser('dept:fixture:fixture-person', {
      fname: 'Fixture',
      lname: 'Quillsby',
      website,
      profileUrls: { departmental: OWNER_PAGE },
    }).then(() => materializeEntity('user', { entityKey: 'dept:fixture:fixture-person' }, {}));

  it('clears a stored patient-care page and does not re-adopt it from a live observation', async () => {
    const owner = await person(PATIENT_CARE_PAGE);

    const result = await materialize(PATIENT_CARE_PAGE);

    expect(String(result.entityId)).toBe(String(owner._id));
    expect(await storedWebsite(owner._id)).toBeUndefined();
  });

  it('replaces a stored patient-care page with an admissible observed website', async () => {
    const owner = await person(PATIENT_CARE_PAGE);

    await materialize(PERSONAL_SITE);

    expect(await storedWebsite(owner._id)).toBe(PERSONAL_SITE);
  });

  it('keeps an admissible stored website', async () => {
    const owner = await person(PERSONAL_SITE);

    await materialize(PERSONAL_SITE);

    expect(await storedWebsite(owner._id)).toBe(PERSONAL_SITE);
  });
});
