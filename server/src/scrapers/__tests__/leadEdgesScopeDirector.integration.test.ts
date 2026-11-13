import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
  ]) {
    await mongoose.connection.db!.collection(name).deleteMany({});
  }
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

const operatorEnd = (rowId: mongoose.Types.ObjectId, personId: mongoose.Types.ObjectId) =>
  RoleAssignment.collection.insertOne({
    personId,
    target: { kind: 'RESEARCH_ENTITY', id: rowId },
    role: 'DIRECTOR',
    state: 'HISTORICAL',
    endedAt: new Date('2025-12-31T00:00:00.000Z'),
    confidence: 0.85,
    reviewStatus: 'UNREVIEWED',
    archived: false,
    rosterProvenance: { sourceName: CENTER_DIRECTOR_SOURCE_NAME, sourceUrl: PROFILE },
    operatorEnd: {
      endedAt: new Date('2025-12-31T00:00:00.000Z'),
      reason: 'synthetic operator end',
      citationUrl: CENTER_URL,
      decidedBy: 'agent',
      recordedAt: new Date('2026-11-12T00:00:00.000Z'),
      previousState: 'UNKNOWN',
    },
  });

describe('the leadEdges scope covers director membership (#6025)', () => {
  it('plans exactly one DIRECTOR edge in a dry run and writes nothing', async () => {
    const { personId, rowId } = await seed();
    const result = await materializeEntity(
      'researchEntity',
      { entityKey: CENTER_SLUG },
      { leadEdgesOnly: true, dryRun: true },
    );

    expect(plannedNewDirectors(result.leadEdgeResolution)).toEqual([
      `${String(personId)}:DIRECTOR`,
    ]);
    expect(await directorEdges(rowId)).toEqual([]);
  });

  it('writes the DIRECTOR edge on apply with no field written', async () => {
    const { personId, rowId } = await seed();
    const before = await ResearchEntity.findById(rowId).lean();
    const result = await materializeEntity(
      'researchEntity',
      { entityKey: CENTER_SLUG },
      { leadEdgesOnly: true },
    );

    expect(result.fieldsWritten).toBe(0);
    expect(await liveDirectorPersonIds(rowId)).toEqual([`${String(personId)}:DIRECTOR`]);
    const after = await ResearchEntity.findById(rowId).lean<Record<string, unknown>>();
    const { updatedAt: _b, ...beforeFields } = before as Record<string, unknown>;
    const { updatedAt: _a, ...afterFields } = after as Record<string, unknown>;
    expect(afterFields).toEqual(beforeFields);
  });

  it('agrees between the dry-run plan and the apply on the same input', async () => {
    const { rowId } = await seed();
    const plan = (
      await materializeEntity(
        'researchEntity',
        { entityKey: CENTER_SLUG },
        { leadEdgesOnly: true, dryRun: true },
      )
    ).leadEdgeResolution;
    const before = await liveDirectorPersonIds(rowId);
    await materializeEntity('researchEntity', { entityKey: CENTER_SLUG }, { leadEdgesOnly: true });
    const created = (await liveDirectorPersonIds(rowId)).filter((edge) => !before.includes(edge));

    expect(created).toEqual(plannedNewDirectors(plan));
    expect(created).toHaveLength(1);
  });

  it('agrees on zero for an operator-ended director, in the plan and on apply', async () => {
    const { personId, rowId } = await seed();
    await operatorEnd(rowId, personId);
    const plan = (
      await materializeEntity(
        'researchEntity',
        { entityKey: CENTER_SLUG },
        { leadEdgesOnly: true, dryRun: true },
      )
    ).leadEdgeResolution;
    await materializeEntity('researchEntity', { entityKey: CENTER_SLUG }, { leadEdgesOnly: true });

    expect(plannedNewDirectors(plan)).toEqual([]);
    expect(await liveDirectorPersonIds(rowId)).toEqual([]);
    expect(await directorEdges(rowId)).toHaveLength(1);
  });

  it('is a no-op the second time', async () => {
    const { rowId } = await seed();
    await materializeEntity('researchEntity', { entityKey: CENTER_SLUG }, { leadEdgesOnly: true });
    const first = await directorEdges(rowId);
    const second = await materializeEntity(
      'researchEntity',
      { entityKey: CENTER_SLUG },
      { leadEdgesOnly: true },
    );

    expect(plannedNewDirectors(second.leadEdgeResolution)).toEqual([]);
    expect((await directorEdges(rowId)).map((edge) => [String(edge.personId), edge.state])).toEqual(
      first.map((edge) => [String(edge.personId), edge.state]),
    );
  });

  it('still skips director membership under any other field scope (#3874)', async () => {
    const { rowId } = await seed();
    await materializeEntity(
      'researchEntity',
      { entityKey: CENTER_SLUG },
      { writeOnlyFields: ['name'] },
    );

    expect(await directorEdges(rowId)).toEqual([]);
  });
});
