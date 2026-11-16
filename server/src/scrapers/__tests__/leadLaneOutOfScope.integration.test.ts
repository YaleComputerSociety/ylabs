import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, syncEntity: vi.fn().mockResolvedValue(undefined) };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return {
    ...actual,
    recomputeBrowseRankForEntities: vi.fn().mockResolvedValue({ updated: 0, indexSyncFailures: 0 }),
  };
});

import { ResearchEntity } from '../../models/researchEntity';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { ScrapeRun } from '../../models/scrapeRun';
import { materializeEntity } from '../entityMaterializer';
import { appendObservations } from '../observationStore';
import {
  CENTER_DIRECTOR_SOURCE_NAME,
  CenterDirectorScraper,
} from '../sources/centerDirectorScraper';
import type { ObservationInput, ScraperContext } from '../types';
import { clearC4Flags } from './c4FlagTestEnv';

const CENTER_SLUG = 'center-synthetic-peace';
const CENTER_NAME = 'Synthetic Peace Center';
const CENTER_URL = 'https://synthetic.yale.edu/center/peace/';
const PROFILE = 'https://medicine.yale.edu/profile/ada-quill/';

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
  clearC4Flags();
  for (const name of [
    'observations',
    'research_entities',
    'role_assignments',
    'researchers',
    'scrape_runs',
    'directory_removals',
  ]) {
    await mongoose.connection.db!.collection(name).deleteMany({});
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const seed = async () => {
  const person = await Researcher.create({
    displayName: 'Ada Quill',
    profileLinks: [
      {
        kind: 'YALE_OFFICIAL',
        purpose: 'PRIMARY_IDENTITY',
        url: PROFILE,
        verifiedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ],
    archived: false,
  });
  const row = await ResearchEntity.create({
    slug: CENTER_SLUG,
    name: CENTER_NAME,
    entityType: 'CENTER',
    websiteUrl: CENTER_URL,
    archived: false,
  });
  const scrapeRunId = new mongoose.Types.ObjectId();
  await ScrapeRun.create({
    _id: scrapeRunId,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName: CENTER_DIRECTOR_SOURCE_NAME,
    status: 'success',
  });
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: String(scrapeRunId),
    sourceId: String(new mongoose.Types.ObjectId()),
    sourceName: CENTER_DIRECTOR_SOURCE_NAME,
    sourceWeight: 0.6,
    options: { dryRun: true, useCache: false, release: false, exhaustive: true },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: () => {},
  };
  await new CenterDirectorScraper({
    fetchPage: async (url) => ({
      url,
      html: `<html><body><div class="card"><h3><a href="${PROFILE}">Ada Quill</a></h3><span>Executive Director</span></div></body></html>`,
    }),
    findTargets: async () => [{ slug: CENTER_SLUG, name: CENTER_NAME, websiteUrl: CENTER_URL }],
  }).run(ctx);
  await appendObservations(emitted, {
    scrapeRunId: String(scrapeRunId),
    sourceId: String(new mongoose.Types.ObjectId()),
    sourceName: CENTER_DIRECTOR_SOURCE_NAME,
    sourceWeight: 0.6,
    dryRun: false,
  });
  return { personId: person._id, rowId: row._id };
};

const directorEdges = (rowId: mongoose.Types.ObjectId) =>
  RoleAssignment.find({ 'target.id': rowId, role: { $in: ['DIRECTOR', 'CO_DIRECTOR'] } }).lean<
    Array<{ personId: unknown; role: string; state?: string; updatedAt?: Date }>
  >();

const liveDirectorPersonIds = async (rowId: mongoose.Types.ObjectId) =>
  (await directorEdges(rowId))
    .filter((edge) => edge.state !== 'HISTORICAL')
    .map((edge) => `${String(edge.personId)}:${edge.role}`)
    .sort();

const plannedNewDirectors = (plan: any) =>
  (plan?.asserted ?? [])
    .filter(
      (edge: any) => edge.isNewEdge && (edge.role === 'DIRECTOR' || edge.role === 'CO_DIRECTOR'),
    )
    .map((edge: any) => `${edge.personId}:${edge.role}`)
    .sort();

const leadEdgePass = (dryRun = false) =>
  materializeEntity(
    'researchEntity',
    { entityKey: CENTER_SLUG },
    { leadEdgesOnly: true, ...(dryRun ? { dryRun: true } : {}) },
  );

const retypeToPersonRow = (rowId: mongoose.Types.ObjectId) =>
  ResearchEntity.collection.updateOne(
    { _id: rowId },
    { $set: { entityType: 'FACULTY_RESEARCH_AREA' } },
  );

describe('a director lane asserts no lead on a row type it does not read (#6327)', () => {
  it('still writes the director edge on an organisation row', async () => {
    const { personId, rowId } = await seed();
    await leadEdgePass();
    expect(await liveDirectorPersonIds(rowId)).toEqual([`${String(personId)}:DIRECTOR`]);
  });

  it('forms no edge on a row retyped to a person row, though the observation stays live', async () => {
    const { rowId } = await seed();
    await retypeToPersonRow(rowId);
    const dryRun = await leadEdgePass(true);
    expect(plannedNewDirectors(dryRun.leadEdgeResolution)).toEqual([]);
    await leadEdgePass();
    expect(await liveDirectorPersonIds(rowId)).toEqual([]);
    expect(
      await mongoose.connection.db!.collection('observations').countDocuments({
        entityKey: CENTER_SLUG,
        field: 'inferredDirectorUserName',
        superseded: { $ne: true },
      }),
    ).toBeGreaterThan(0);
  });

  it('ends the edge the lane wrote before the retype and does not re-create it', async () => {
    const { personId, rowId } = await seed();
    await leadEdgePass();
    expect(await liveDirectorPersonIds(rowId)).toEqual([`${String(personId)}:DIRECTOR`]);
    await retypeToPersonRow(rowId);

    const dryRun = await leadEdgePass(true);
    expect(dryRun.leadEdgeResolution?.ended).toEqual([
      expect.objectContaining({ personId: String(personId), reason: 'lane-out-of-scope' }),
    ]);
    await leadEdgePass();
    expect(await liveDirectorPersonIds(rowId)).toEqual([]);
    await leadEdgePass();
    expect(await liveDirectorPersonIds(rowId)).toEqual([]);
  });
});
