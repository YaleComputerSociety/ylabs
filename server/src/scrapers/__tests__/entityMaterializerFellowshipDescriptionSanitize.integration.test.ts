import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, syncEntity: vi.fn().mockResolvedValue(undefined) };
});

import { Fellowship } from '../../models/fellowship';
import { Observation } from '../../models/observation';
import { materializeEntity } from '../entityMaterializer';

const SOURCE_KEY = 'yale-college-fellowships-office:fixture-summer-research-grant';
const SOURCE_NAME = 'yale-college-fellowships-office';

const CLEAN_DESCRIPTION =
  'The summer research grant funds Yale College undergraduates undertaking original faculty-mentored laboratory research during the summer term.';

const FAQ_DUMP =
  'Frequently Asked Questions. Who is eligible? All Yale College undergraduates. When is the deadline? In March. How do I apply for the grant?';

const CHROME_AND_EMAIL_DIRTY =
  'Skip to main content Show all breadcrumbs The travel research grant supports undergraduate summer fieldwork abroad. Direct questions to grants@example.edu before applying.';

const CHROME_AND_EMAIL_CLEAN =
  'The travel research grant supports undergraduate summer fieldwork abroad.';

type PersistedFellowship = { description?: string; summary?: string };

describe('materializeEntity sanitizes fellowship/program descriptions at the write step (#670/#671 durability)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'fellowships']) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedObservation = async (field: string, value: unknown) => {
    await Observation.create({
      entityType: 'fellowship',
      entityKey: SOURCE_KEY,
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: SOURCE_NAME,
      sourceUrl: 'https://example.edu/fellowships/summer-research-grant/',
      confidence: 0.95,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: false,
    });
  };

  const seedStaleRecord = async (storedDescription: string) => {
    await Fellowship.create({
      title: 'Fixture Summer Research Grant',
      sourceKey: SOURCE_KEY,
      sourceName: SOURCE_NAME,
      description: storedDescription,
      archived: false,
    });
  };

  it('re-materialize over a stale FAQ-dump observation fails closed to an empty description', async () => {
    await seedStaleRecord(CLEAN_DESCRIPTION);
    await seedObservation('title', 'Fixture Summer Research Grant');
    await seedObservation('sourceName', SOURCE_NAME);
    await seedObservation('description', FAQ_DUMP);

    await materializeEntity('fellowship', { entityKey: SOURCE_KEY });

    const persisted = await Fellowship.findOne({
      sourceKey: SOURCE_KEY,
    }).lean<PersistedFellowship>();
    expect(persisted?.description).toBe('');
    expect(persisted?.description).not.toContain('Frequently Asked Questions');
  });

  it('re-materialize strips chrome and the leaked contact token instead of re-clobbering', async () => {
    await seedStaleRecord(CHROME_AND_EMAIL_CLEAN);
    await seedObservation('title', 'Fixture Summer Research Grant');
    await seedObservation('sourceName', SOURCE_NAME);
    await seedObservation('description', CHROME_AND_EMAIL_DIRTY);

    await materializeEntity('fellowship', { entityKey: SOURCE_KEY });

    const persisted = await Fellowship.findOne({
      sourceKey: SOURCE_KEY,
    }).lean<PersistedFellowship>();
    expect(persisted?.description).toBe(CHROME_AND_EMAIL_CLEAN);
    expect(persisted?.description).not.toMatch(/breadcrumbs|Skip to main content/i);
    expect(persisted?.description).not.toMatch(/redacted/i);
    expect(persisted?.description).not.toMatch(/@example\.edu/);
  });

  it('writes genuine clean prose verbatim so a valid description is never mangled', async () => {
    await seedStaleRecord('');
    await seedObservation('title', 'Fixture Summer Research Grant');
    await seedObservation('sourceName', SOURCE_NAME);
    await seedObservation('description', CLEAN_DESCRIPTION);

    await materializeEntity('fellowship', { entityKey: SOURCE_KEY });

    const persisted = await Fellowship.findOne({
      sourceKey: SOURCE_KEY,
    }).lean<PersistedFellowship>();
    expect(persisted?.description).toBe(CLEAN_DESCRIPTION);
  });

  it('also sanitizes the summary field, failing closed on a curation-rationale dump', async () => {
    await seedStaleRecord(CLEAN_DESCRIPTION);
    await seedObservation('title', 'Fixture Summer Research Grant');
    await seedObservation('sourceName', SOURCE_NAME);
    await seedObservation('description', CLEAN_DESCRIPTION);
    await seedObservation(
      'summary',
      'This award is source-backed and safe to show prominently until a more specific current award page is attached.',
    );

    await materializeEntity('fellowship', { entityKey: SOURCE_KEY });

    const persisted = await Fellowship.findOne({
      sourceKey: SOURCE_KEY,
    }).lean<PersistedFellowship>();
    expect(persisted?.summary).toBe('');
    expect(persisted?.description).toBe(CLEAN_DESCRIPTION);
  });
});
