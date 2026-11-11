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
import { materializeEntity } from '../../scrapers/entityMaterializer';
import { resetDirectoryNetidsByAddressCache } from '../../scrapers/directoryContradictedProfileNetid';
import {
  parseComputeResearcherEmailSupportArgs,
  runResearcherEmailSupportPass,
} from '../computeResearcherEmailSupport';

const PAGE = 'https://engineering.yale.edu/faculty-directory/avery-synthetic/';
const SOURCE = 'fixture-official-profile';
const REACHED = {
  netid: 'fxavery5627',
  email: 'avery.synthetic5627@yale.edu',
  displayName: 'Avery Synthetic',
};
const UNREACHED = {
  netid: 'fxrobin5627',
  email: 'robin.synthetic5627@yale.edu',
  displayName: 'Robin Synthetic',
};

const marker = async (netid: string) =>
  (await Researcher.findOne({ 'identifiers.netid': netid }).lean())?.identifiers?.emailSupport;

describe('the researcher-level email support pass marks every researcher holding an email (#5627)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    await Observation.syncIndexes();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    resetDirectoryNetidsByAddressCache();
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'researchers', 'accounts']) {
      await db.collection(name).deleteMany({});
    }
    for (const person of [REACHED, UNREACHED]) {
      await Researcher.collection.insertOne({
        displayName: person.displayName,
        identifiers: { netid: person.netid, email: person.email },
        profileLinks: [],
        status: 'ACTIVE',
        archived: false,
        schemaVersion: 1,
      });
    }
    await Observation.insertMany(
      Object.entries({ displayName: REACHED.displayName, email: REACHED.email }).map(
        ([field, value]) => ({
          entityType: 'user',
          entityKey: `netid:${REACHED.netid}`,
          sourceId: new mongoose.Types.ObjectId(),
          sourceName: SOURCE,
          sourceUrl: PAGE,
          confidence: 0.95,
          observedAt: new Date('2026-06-05T00:00:00Z'),
          superseded: false,
          field,
          value,
        }),
      ),
    );
  });

  it('writes nothing on a dry run', async () => {
    const report = await runResearcherEmailSupportPass({ apply: false });

    expect(report).toMatchObject({ researchersScanned: 2, planned: 2, applied: null });
    expect(await marker(UNREACHED.netid)).toBeUndefined();
  }, 60000);

  it('marks a researcher no user key reaches, and a second run plans nothing', async () => {
    const first = await runResearcherEmailSupportPass({ apply: true });

    expect(first).toMatchObject({ supported: 1, unsupported: 1, planned: 2, applied: 2 });
    expect(await marker(UNREACHED.netid)).toEqual({
      supported: false,
      sources: [],
      computedForEmail: UNREACHED.email,
    });

    const second = await runResearcherEmailSupportPass({ apply: true });
    expect(second).toMatchObject({ planned: 0, applied: 0 });
  }, 60000);

  it('agrees with the marker the resolve path stores for a reached researcher', async () => {
    await materializeEntity('user', { entityKey: `netid:${REACHED.netid}` });
    const fromResolve = await marker(REACHED.netid);
    expect(fromResolve).toEqual({
      supported: true,
      sources: [SOURCE],
      computedForEmail: REACHED.email,
    });

    await Researcher.collection.updateOne(
      { 'identifiers.netid': REACHED.netid },
      { $unset: { 'identifiers.emailSupport': 1 } },
    );
    await runResearcherEmailSupportPass({ apply: true });
    expect(await marker(REACHED.netid)).toEqual(fromResolve);

    await materializeEntity('user', { entityKey: `netid:${REACHED.netid}` });
    expect((await runResearcherEmailSupportPass({ apply: false })).planned).toBe(0);
  }, 60000);

  it('is dry-run by default and needs --apply to write', () => {
    expect(parseComputeResearcherEmailSupportArgs([]).dryRun).toBe(true);
    expect(parseComputeResearcherEmailSupportArgs(['--apply']).dryRun).toBe(false);
  });
});
