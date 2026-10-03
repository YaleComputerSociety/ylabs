import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { mongoOptions } from '../../db/connections';
import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { ACTIVE_SOURCE_NAMES } from '../../scrapers/seedSources';
import {
  GRANT_OR_ORCID_LANE_SOURCE_NAMES,
  parsePortGrantShellArgs,
  runGrantShellPort,
} from '../portGrantShellsToFacultyProfiles';

vi.mock('../../services/meiliSyncService', () => ({
  deleteFromIndex: vi.fn(async () => true),
  syncEntities: vi.fn(async () => undefined),
}));
vi.mock('../../scrapers/entityMaterializer', () => ({
  materializeEntity: vi.fn(async () => undefined),
}));

const GRANT_URL = 'https://reporter.nih.gov/project-details/00000000';

describe('the grant-only archive is bounded by the cap and reads URL-less evidence (#4247)', () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri(), mongoOptions);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await server?.stop();
  });

  beforeEach(async () => {
    await mongoose.connection.db!.dropDatabase();
  });

  async function seedGrantOnlyRow(slug: string) {
    const _id = new mongoose.Types.ObjectId();
    await ResearchEntity.collection.insertOne({
      _id,
      slug,
      name: 'Synthetic Grant Row',
      entityType: 'FACULTY_RESEARCH_AREA',
      sourceUrls: [GRANT_URL],
      studentVisibilityTier: 'operator_review',
      archived: false,
    });
    await Observation.collection.insertOne({
      entityType: 'researchEntity',
      entityId: _id,
      entityKey: slug,
      field: 'recentGrantCount',
      value: 1,
      sourceName: 'nih-reporter',
      sourceUrl: GRANT_URL,
      observedAt: new Date('2026-09-01T00:00:00Z'),
      superseded: false,
    });
    return _id;
  }

  async function archivedSlugs(): Promise<string[]> {
    const rows = await ResearchEntity.collection
      .find({ archived: true }, { projection: { slug: 1 } })
      .toArray();
    return rows.map((row) => String(row.slug)).sort();
  }

  it('a cap of zero archives nothing and reports every deferred archive', async () => {
    await seedGrantOnlyRow('nih-pi-synthetic-one');
    await seedGrantOnlyRow('nih-pi-synthetic-two');

    const { delta } = await runGrantShellPort({ dryRun: false, confirmed: true, maxPorts: 0 });

    expect(await archivedSlugs()).toEqual([]);
    expect(delta.grantOnlyPlannedArchives).toBe(2);
    expect(delta.grantOnlyArchived).toBe(0);
    expect(delta.grantOnlyDeferredByCap).toBe(2);
  });

  it('a row carrying URL-less evidence from a non-grant lane is not archived', async () => {
    await seedGrantOnlyRow('nih-pi-synthetic-one');
    const corroboratedId = await seedGrantOnlyRow('nih-pi-synthetic-two');
    await Observation.collection.insertOne({
      entityType: 'researchEntity',
      entityId: corroboratedId,
      entityKey: 'nih-pi-synthetic-two',
      field: 'fullDescription',
      value: 'Synthetic description of research.',
      sourceName: 'lab-microsite-description-llm',
      observedAt: new Date('2026-09-02T00:00:00Z'),
      superseded: false,
    });

    const { delta } = await runGrantShellPort({ dryRun: false, confirmed: true, maxPorts: 10 });

    expect(await archivedSlugs()).toEqual(['nih-pi-synthetic-one']);
    expect(delta.grantOnlyArchived).toBe(1);
  });

  it('a row whose only other-lane evidence cites a grant record is still archived', async () => {
    const rowId = await seedGrantOnlyRow('nih-pi-synthetic-one');
    await Observation.collection.insertOne({
      entityType: 'researchEntity',
      entityId: rowId,
      entityKey: 'nih-pi-synthetic-one',
      field: 'fullDescription',
      value: 'Synthetic description of research.',
      sourceName: 'lab-microsite-description-llm',
      sourceUrl: GRANT_URL,
      observedAt: new Date('2026-09-02T00:00:00Z'),
      superseded: false,
    });

    await runGrantShellPort({ dryRun: false, confirmed: true, maxPorts: 10 });

    expect(await archivedSlugs()).toEqual(['nih-pi-synthetic-one']);
  });

  it('--max-archives bounds the archive separately and defaults to --max-ports', () => {
    expect(parsePortGrantShellArgs(['--max-ports', '0']).maxArchives).toBeUndefined();
    expect(parsePortGrantShellArgs(['--max-archives', '3']).maxArchives).toBe(3);
    expect(() => parsePortGrantShellArgs(['--max-archives', '-1'])).toThrow();
  });

  it('every grant lane name is a registered source', () => {
    const registered = new Set(ACTIVE_SOURCE_NAMES);
    for (const name of GRANT_OR_ORCID_LANE_SOURCE_NAMES) expect(registered.has(name)).toBe(true);
  });
});
