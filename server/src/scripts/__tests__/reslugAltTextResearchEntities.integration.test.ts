import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntities: vi.fn(async (_type: string, docs: unknown[]) => docs.length),
  syncEntity: vi.fn(async () => true),
  deleteFromIndex: vi.fn(async () => {}),
}));

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, ...meiliMocks };
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

import routes from '../../routes';
import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { ScrapeRun } from '../../models/scrapeRun';
import { materializeFromRun } from '../../scrapers/entityMaterializer';
import { appendObservations } from '../../scrapers/observationStore';
import {
  DEFAULT_DEPT_CONFIGS,
  nodePersonCardExtractor,
  rosterResearchEntitySlug,
  withoutUnheldSceneIdentity,
  type DeptConfig,
} from '../../scrapers/sources/departmentRosterScraper';
import { normalizeName } from '../../scrapers/utils/scraperHelpers';
import { toPublicResearchEntityDto } from '../../services/researchEntityDto';
import { buildResearchEntitySearchIndexDocument } from '../../services/researchEntitySearchIndexService';
import { clearC4Flags } from '../../scrapers/__tests__/c4FlagTestEnv';
import { withMergedFromAtCopyTime } from '../archivedTombstoneMirror';
import {
  ALT_TEXT_RESLUG_REASON,
  assertAltTextReslugApplyAllowed,
  parseAltTextReslugArgs,
  runAltTextReslug,
} from '../reslugAltTextResearchEntitiesCore';

const SOURCE_ID = new mongoose.Types.ObjectId();
const SOURCE_NAME = 'department-roster';
const CAPTION_SLUG = 'dept-school-of-music-photo-of-dean-robin-fixture';
const CAPTION_TARGET = 'dept-school-of-music-robin-fixture';
const SCENE_SLUG = 'dept-school-of-music-man-in-green-suit-holding-sam-fixture';
const SCENE_TARGET = 'dept-school-of-music-sam-fixture';
const NAME_SLUG = 'dept-school-of-music-avery-fixture';
const RENAMED_AT = new Date('2026-11-11T00:00:00Z');
const MUSIC = DEFAULT_DEPT_CONFIGS.find((c) => c.deptKey === 'school-of-music') as DeptConfig;
const CAPTION_CARD = `
  <article about="/people/robin-fixture" class="node node--type-person node--view-mode-card">
    <div class="top"><div class="field field--name-field-profile-image field__item">
      <img src="/img/robin-fixture.jpg" alt="Photo of Dean Robin Fixture."></div></div>
    <div class="card-content"><h2><span>Robin Fixture</span></h2>
      <div class="paragraph--type--title-affiliation">Professor of Synthetic Music</div></div>
  </article>`;

const servedRow = (slug: string, personName: string, extra: Record<string, unknown> = {}) =>
  ResearchEntity.create({
    slug,
    name: `${personName} Faculty Research`,
    kind: 'individual',
    entityType: 'FACULTY_RESEARCH_AREA',
    studentVisibilityTier: 'student_ready',
    shortDescription: 'Studies synthetic counterpoint in chamber music.',
    fullDescription: 'The research studies how synthetic counterpoint shapes chamber music.',
    ...extra,
  });

const keylessObservation = (entityKey: string) =>
  Observation.create({
    entityType: 'researchEntity',
    entityKey,
    field: 'name',
    value: 'Synthetic name evidence',
    confidence: 0.8,
    sourceId: SOURCE_ID,
    sourceName: SOURCE_NAME,
    scrapeRunId: new mongoose.Types.ObjectId(),
    observedAt: new Date(),
  });

const slugs = async () =>
  (await ResearchEntity.find({}).select('slug').lean<Array<{ slug: string }>>())
    .map((row) => row.slug)
    .sort();

const reslug = (apply: boolean) => runAltTextReslug({ apply, now: RENAMED_AT });

async function runKeyOnlyLane(entityKey: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 5));
  const scrapeRunId = new mongoose.Types.ObjectId();
  await ScrapeRun.create({
    _id: scrapeRunId,
    sourceId: SOURCE_ID,
    sourceName: SOURCE_NAME,
    status: 'running',
  });
  const base = {
    entityType: 'researchEntity' as const,
    entityKey,
    sourceUrl: 'https://fixture-music.example.edu/people/robin-fixture',
  };
  await appendObservations(
    [
      { ...base, field: 'slug', value: entityKey },
      { ...base, field: 'name', value: 'Robin Fixture Faculty Research' },
      { ...base, field: 'entityType', value: 'FACULTY_RESEARCH_AREA' },
    ],
    {
      scrapeRunId: String(scrapeRunId),
      sourceId: String(SOURCE_ID),
      sourceName: SOURCE_NAME,
      sourceWeight: 0.8,
      dryRun: false,
    },
  );
  await materializeFromRun(String(scrapeRunId));
}

describe('research-entity:reslug-alt-text-slugs arguments', () => {
  it('is a dry run unless told to apply', () => {
    expect(parseAltTextReslugArgs([])).toEqual({ apply: false, confirm: false });
    expect(parseAltTextReslugArgs(['--apply', '--confirm'])).toEqual({
      apply: true,
      confirm: true,
    });
    expect(() => parseAltTextReslugArgs(['--slug', CAPTION_SLUG])).toThrow(/takes no identifier/);
  });

  it('refuses an apply without --confirm, and outside Development', () => {
    expect(() =>
      assertAltTextReslugApplyAllowed({ apply: true, confirm: false }, 'host/Development'),
    ).toThrow(/--confirm/);
    expect(() =>
      assertAltTextReslugApplyAllowed({ apply: true, confirm: true }, 'host/Beta'),
    ).toThrow(/restricted to a Development database/);
    expect(() =>
      assertAltTextReslugApplyAllowed({ apply: true, confirm: true }, 'host/Development'),
    ).not.toThrow();
    expect(() =>
      assertAltTextReslugApplyAllowed({ apply: false, confirm: false }, 'host/Prod'),
    ).not.toThrow();
  });
});

describe('research-entity:reslug-alt-text-slugs renames rows minted from photo alt text (#5808)', () => {
  let replSet: MongoMemoryReplSet;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    await Observation.syncIndexes();
    await ResearchEntity.syncIndexes();
    const app = express();
    app.use(express.json());
    app.use('/api', routes);
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, () => resolve(listening));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    clearC4Flags();
    meiliMocks.syncEntities.mockClear();
    const db = mongoose.connection.db!;
    for (const name of ['observations', 'research_entities', 'scrape_runs']) {
      await db.collection(name).deleteMany({});
    }
  });

  async function seedAltTextRows() {
    const caption = await servedRow(CAPTION_SLUG, 'Robin Fixture');
    const scene = await servedRow(SCENE_SLUG, 'Sam Fixture');
    const named = await servedRow(NAME_SLUG, 'Avery Fixture');
    await keylessObservation(CAPTION_SLUG);
    await keylessObservation(SCENE_SLUG);
    return { caption, scene, named };
  }

  it('writes nothing on a dry run', async () => {
    await seedAltTextRows();
    const before = await slugs();

    const report = await reslug(false);

    expect(report).toMatchObject({
      apply: false,
      liveRosterRows: 3,
      rowsWithAltTextSlug: 2,
      servedRowsWithAltTextSlug: 2,
      rowsWithNoUsableName: 0,
      rowsToRename: 2,
      rowsTakingANumberedSlug: 0,
      observationsToStamp: 2,
    });
    expect(report.rowsRenamed).toBeUndefined();
    expect(await slugs()).toEqual(before);
    expect(await Observation.countDocuments({ entityId: { $ne: null } })).toBe(0);
    expect(meiliMocks.syncEntities).not.toHaveBeenCalled();
  });

  it('gives each alt-text row the slug of its name and records the old slug', async () => {
    const { caption, scene, named } = await seedAltTextRows();

    const report = await reslug(true);

    expect(report).toMatchObject({
      rowsToRename: 2,
      rowsRenamed: 2,
      observationsStamped: 2,
      searchDocumentsResynced: 2,
    });
    expect(await slugs()).toEqual([CAPTION_TARGET, NAME_SLUG, SCENE_TARGET].sort());
    const renamed = await ResearchEntity.findById(caption._id).lean<any>();
    expect(renamed.previousSlugs).toEqual([
      { slug: CAPTION_SLUG, renamedAt: RENAMED_AT, reason: ALT_TEXT_RESLUG_REASON },
    ]);
    expect((await ResearchEntity.findById(scene._id).lean<any>()).previousSlugs).toEqual([
      { slug: SCENE_SLUG, renamedAt: RENAMED_AT, reason: ALT_TEXT_RESLUG_REASON },
    ]);
    expect((await ResearchEntity.findById(named._id).lean<any>()).previousSlugs).toBeUndefined();
    expect(
      await Observation.countDocuments({ entityKey: CAPTION_SLUG, entityId: caption._id }),
    ).toBe(1);
    expect(await Observation.countDocuments({ reslugAdoption: true })).toBe(2);
    const synced = meiliMocks.syncEntities.mock.calls.flatMap(([, docs]) => docs as any[]);
    expect(synced.map((doc) => doc.slug).sort()).toEqual([CAPTION_TARGET, SCENE_TARGET].sort());
  });

  it('redirects the old slug to the new one and serves the new one', async () => {
    await seedAltTextRows();
    await reslug(true);

    const old = await fetch(`${baseUrl}/api/research/${CAPTION_SLUG}`, { redirect: 'manual' });
    expect(old.status).toBe(302);
    expect(old.headers.get('location')).toBe(`/api/research/${CAPTION_TARGET}`);
    expect((await fetch(`${baseUrl}/api/research/${CAPTION_TARGET}`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/research/${NAME_SLUG}`)).status).toBe(200);
  });

  it('is a no-op on a second apply', async () => {
    await seedAltTextRows();
    await reslug(true);
    const afterFirst = await ResearchEntity.find({}).sort({ _id: 1 }).lean();
    meiliMocks.syncEntities.mockClear();

    const second = await reslug(true);

    expect(second).toMatchObject({ rowsToRename: 0, rowsRenamed: 0, observationsStamped: 0 });
    const afterSecond = await ResearchEntity.find({}).sort({ _id: 1 }).lean();
    expect(afterSecond.map((row: any) => [row.slug, row.previousSlugs])).toEqual(
      afterFirst.map((row: any) => [row.slug, row.previousSlugs]),
    );
    expect(meiliMocks.syncEntities).not.toHaveBeenCalled();
  });

  it('numbers the new slug when a row already holds the name slug', async () => {
    await servedRow(CAPTION_SLUG, 'Robin Fixture');
    await servedRow(CAPTION_TARGET, 'Robin Fixture', { archived: true });

    const report = await reslug(true);

    expect(report.rowsTakingANumberedSlug).toBe(1);
    expect(await ResearchEntity.countDocuments({ slug: `${CAPTION_TARGET}-2` })).toBe(1);
  });

  it('takes the name inside a captioned row name, and holds a row with no name', async () => {
    await servedRow(CAPTION_SLUG, 'Photo of Robin');
    await servedRow(SCENE_SLUG, '');

    const report = await reslug(true);

    expect(report).toMatchObject({ rowsWithAltTextSlug: 2, rowsWithNoUsableName: 1 });
    expect(await ResearchEntity.countDocuments({ slug: 'dept-school-of-music-robin' })).toBe(1);
    expect(await ResearchEntity.countDocuments({ slug: SCENE_SLUG })).toBe(1);
  });

  it('keeps the redirect once the stamped observations are pruned', async () => {
    await seedAltTextRows();
    await reslug(true);
    await Observation.deleteMany({});

    const old = await fetch(`${baseUrl}/api/research/${CAPTION_SLUG}`, { redirect: 'manual' });
    expect(old.status).toBe(302);
    expect(old.headers.get('location')).toBe(`/api/research/${CAPTION_TARGET}`);
  });

  it('renames a row to the key the roster lane emits for the same card on its next run', async () => {
    const [entry] = nodePersonCardExtractor(CAPTION_CARD, {
      pageUrl: 'https://music.yale.edu/meet-our-faculty',
    });
    const heldSlug = rosterResearchEntitySlug(entry, MUSIC);
    await servedRow(heldSlug, normalizeName(entry.name));

    await reslug(true);

    const corpusAfterReslug = new Map((await slugs()).map((slug) => [slug, {}]));
    const nextLaneKey = rosterResearchEntitySlug(
      withoutUnheldSceneIdentity(entry, MUSIC, corpusAfterReslug),
      MUSIC,
    );
    expect(heldSlug).toBe(CAPTION_SLUG);
    expect(await slugs()).toEqual([nextLaneKey]);
  });

  it('holds a row whose name is not the person name the lane writes, such as a stated lab name', async () => {
    await servedRow(CAPTION_SLUG, '', { name: 'Synthetic Counterpoint Studio', kind: 'lab' });

    const report = await reslug(true);

    expect(report).toMatchObject({
      rowsWithAltTextSlug: 1,
      rowsWithNoUsableName: 1,
      rowsRenamed: 0,
    });
    expect(await slugs()).toEqual([CAPTION_SLUG]);
  });

  it(
    'adopts the renamed row when a lane re-emits the old key, run twice',
    { timeout: 60000 },
    async () => {
      await seedAltTextRows();
      await reslug(true);

      await runKeyOnlyLane(CAPTION_SLUG);
      await runKeyOnlyLane(CAPTION_SLUG);

      expect(await ResearchEntity.countDocuments({ slug: CAPTION_SLUG })).toBe(0);
      expect(await slugs()).toEqual([CAPTION_TARGET, NAME_SLUG, SCENE_TARGET].sort());
    },
  );

  it(
    'mints nothing at the old slug and redirects nowhere once the renamed row is archived',
    { timeout: 60000 },
    async () => {
      const { caption } = await seedAltTextRows();
      await reslug(true);
      await ResearchEntity.updateOne({ _id: caption._id }, { $set: { archived: true } });

      await runKeyOnlyLane(CAPTION_SLUG);
      await runKeyOnlyLane(CAPTION_SLUG);

      expect(await ResearchEntity.countDocuments({ slug: CAPTION_SLUG })).toBe(0);
      const old = await fetch(`${baseUrl}/api/research/${CAPTION_SLUG}`, { redirect: 'manual' });
      expect(old.status).toBe(404);
    },
  );

  it('never serves or indexes the previous slugs, and promotion carries them', async () => {
    const { caption } = await seedAltTextRows();
    await reslug(true);
    const row = await ResearchEntity.findById(caption._id).lean<any>();

    const dto = toPublicResearchEntityDto(row);
    expect(dto).not.toHaveProperty('previousSlugs');
    expect(JSON.stringify(dto)).not.toContain(CAPTION_SLUG);
    const searchDocument = buildResearchEntitySearchIndexDocument(row);
    expect(searchDocument).not.toHaveProperty('previousSlugs');
    expect(searchDocument?.slug).toBe(CAPTION_TARGET);
    expect(JSON.stringify(searchDocument)).not.toContain(CAPTION_SLUG);
    const served = await (await fetch(`${baseUrl}/api/research/${CAPTION_TARGET}`)).text();
    expect(served).not.toContain(CAPTION_SLUG);

    const promoted = withMergedFromAtCopyTime(new Map())(row);
    expect(promoted.previousSlugs).toEqual(row.previousSlugs);
  });
});
