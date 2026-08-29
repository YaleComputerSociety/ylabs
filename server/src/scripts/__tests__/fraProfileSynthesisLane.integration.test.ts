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
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { Source } from '../../models/source';
import { materializeEntity } from '../../scrapers/entityMaterializer';
import { resetOrgUnitCanonicalizerCache } from '../../scrapers/orgUnitCanonicalization';
import { toPublicResearchEntityDto } from '../../services/researchEntityDto';
import type { CoverageSynthesisLLMFn } from '../../scrapers/coverageSynthesis';
import {
  FRA_PROFILE_SYNTHESIS_CONFIDENCE,
  FRA_PROFILE_SYNTHESIS_SOURCE_NAME,
} from '../fraProfileSynthesisCore';
import {
  profileUrlOf,
  runFraProfileSynthesisEntity,
  selectFraProfileSynthesisTargets,
  type FraProfileSynthesisEntity,
} from '../fraProfileSynthesisLane';

const SLUG = 'fra-profile-lane-fixture';
const PROFILE_URL = 'https://medicine.example.edu/profile/avery_lin/';

/**
 * The confidence the official faculty-directory scrapers stamp on the
 * profile-page prose this lane exists to replace (ysmFacultyDirectoryScraper.ts,
 * yseFacultyDirectoryScraper.ts). Deliberately higher than the lane's own.
 */
const PROFILE_DESCRIPTION_CONFIDENCE = 0.55;

/**
 * Bio-shaped and yet a *useful* description by `fullDescriptionQuality`, which is
 * the case that actually reproduces the defect: the materializer only walks the
 * ranked fallback list when the resolver's winner fails that quality bar, so a
 * bio that clears it is served unchanged no matter what the lane appends.
 */
const PROFILE_BIO =
  'Dr. Avery Lin is an immunologist at Yale University, where she teaches in the graduate immunology program, mentors postdoctoral trainees, and advises undergraduates on research careers.';

const PROFILE_PAGE_TEXT = [
  'YSM Home INFORMATION FOR Find People Organization Charts Departments & Centers Volunteer to Help Donate Blood',
  'Dr Lin received her medical degree from a university abroad and completed a residency in internal medicine before joining Yale in 2016.',
  'Our laboratory investigates how mucosal immune cells restrain inflammation in the human intestine, using organoid co-culture and single-cell sequencing to map the signals that keep the epithelial barrier intact.',
  'We also study how the same regulatory circuits fail in inflammatory bowel disease in the U.S. and develop computational models that predict which patients relapse.',
].join(' ');

const SYNTHESIZED_RESEARCH =
  'Investigates how mucosal immune cells restrain inflammation in the human intestine, using organoid co-culture and single-cell sequencing to map the signals that keep the epithelial barrier intact, and studies how the same regulatory circuits fail in inflammatory bowel disease.';

const PRONOUN_LED_SYNTHESIS = `Her laboratory investigates how mucosal immune cells restrain inflammation in the human intestine, using organoid co-culture and single-cell sequencing to map the epithelial barrier signals. Her group has published widely on inflammatory bowel disease relapse in the intestine.`;

/**
 * Thirteen words, so it clears the synthesizer's 12-word floor, and repairing the
 * possessive lead removes two of them. The synthesizer's quality gate only ever
 * sees the pre-repair text, so without a re-check the lane wrote an 11-word
 * description that the materializer then rejects.
 */
const REPAIR_SHORTENED_SYNTHESIS =
  'Her research investigates how mucosal immune cells restrain inflammation in the human intestine.';

const OFFICIAL_RESEARCH_STATEMENT =
  'The Lin Laboratory studies how mucosal immune cells restrain intestinal inflammation, combining organoid co-culture, single-cell sequencing, and computational modeling to predict relapse in inflammatory bowel disease.';

const stubLLM =
  (fullDescription: string): CoverageSynthesisLLMFn =>
  async ({ snippets }) => ({
    fullDescription,
    usedSnippetIndexes: snippets.map((_snippet, index) => index),
  });

async function runLane(
  callLLM: CoverageSynthesisLLMFn,
  options: { apply?: boolean; pageText?: string } = {},
) {
  const entity = (await ResearchEntity.findOne({ slug: SLUG }).lean()) as FraProfileSynthesisEntity;
  const source = await Source.findOne({ name: FRA_PROFILE_SYNTHESIS_SOURCE_NAME }).lean();
  return runFraProfileSynthesisEntity({
    entity,
    profileUrl: profileUrlOf(entity.sourceUrls),
    callLLM,
    fetchProfileText: async () => options.pageText ?? PROFILE_PAGE_TEXT,
    apply: options.apply ?? true,
    runId: new mongoose.Types.ObjectId().toString(),
    sourceId: String(source?._id ?? ''),
  });
}

const seedFra = async (overrides: Record<string, unknown> = {}) =>
  ResearchEntity.create({
    slug: SLUG,
    name: 'Avery Lin Faculty Research',
    kind: 'individual',
    entityType: 'FACULTY_RESEARCH_AREA',
    studentVisibilityTier: 'operator_review',
    archived: false,
    researchAreas: ['Immunology', 'Gastroenterology'],
    sourceUrls: [PROFILE_URL],
    ...overrides,
  });

const seedFullDescriptionObservation = async (
  value: string,
  sourceName: string,
  confidence: number,
  observedAt = new Date(),
) =>
  Observation.create({
    entityType: 'researchEntity',
    entityKey: SLUG,
    field: 'fullDescription',
    value,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName,
    sourceUrl: PROFILE_URL,
    confidence,
    observedAt,
    superseded: false,
  });

describe('FACULTY_RESEARCH_AREA profile-synthesis lane (#2200)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    resetOrgUnitCanonicalizerCache();
    await mongoose.disconnect();
    await replSet.stop();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities', 'sources']) {
      await db.collection(name).deleteMany({});
    }
    await Source.create([
      {
        name: FRA_PROFILE_SYNTHESIS_SOURCE_NAME,
        displayName: 'Faculty research-area profile synthesis LLM',
        defaultWeight: FRA_PROFILE_SYNTHESIS_CONFIDENCE,
      },
      {
        name: 'ysm-faculty-directory',
        displayName: 'YSM faculty directory',
        defaultWeight: PROFILE_DESCRIPTION_CONFIDENCE,
      },
    ]);
    resetOrgUnitCanonicalizerCache();
  });

  it('replaces the served biography that the profile directory re-emits at a higher confidence', async () => {
    await seedFra();
    await seedFullDescriptionObservation(
      PROFILE_BIO,
      'ysm-faculty-directory',
      PROFILE_DESCRIPTION_CONFIDENCE,
    );
    await materializeEntity(
      'researchEntity',
      { entityKey: SLUG },
      { dryRun: false, synthesizeCardDescription: async () => '' },
    );
    const beforeLane = (await ResearchEntity.findOne({ slug: SLUG }).lean()) as Record<string, any>;
    expect(beforeLane.fullDescription).toBe(PROFILE_BIO);

    const report = await runLane(stubLLM(SYNTHESIZED_RESEARCH));

    expect(report).toMatchObject({ synthesized: true, written: true });
    const persisted = (await ResearchEntity.findOne({ slug: SLUG }).lean()) as Record<string, any>;
    expect(persisted.fullDescription).toBe(SYNTHESIZED_RESEARCH);
    expect(persisted.fieldProvenance?.fullDescription?.sourceName).toBe(
      FRA_PROFILE_SYNTHESIS_SOURCE_NAME,
    );
    const served = toPublicResearchEntityDto(persisted) as Record<string, any>;
    expect(served.fullDescription).toBe(SYNTHESIZED_RESEARCH);
  });

  it('keeps the synthesized description after the directory re-scrapes the biography', async () => {
    await seedFra();
    await seedFullDescriptionObservation(
      PROFILE_BIO,
      'ysm-faculty-directory',
      PROFILE_DESCRIPTION_CONFIDENCE,
    );
    await runLane(stubLLM(SYNTHESIZED_RESEARCH));

    await seedFullDescriptionObservation(
      PROFILE_BIO,
      'ysm-faculty-directory',
      PROFILE_DESCRIPTION_CONFIDENCE,
      new Date(),
    );
    await materializeEntity(
      'researchEntity',
      { entityKey: SLUG },
      { dryRun: false, synthesizeCardDescription: async () => '' },
    );

    const persisted = (await ResearchEntity.findOne({ slug: SLUG }).lean()) as Record<string, any>;
    expect(persisted.fullDescription).toBe(SYNTHESIZED_RESEARCH);
  });

  it('records the observation at the lane confidence', async () => {
    await seedFra();
    await seedFullDescriptionObservation(
      PROFILE_BIO,
      'ysm-faculty-directory',
      PROFILE_DESCRIPTION_CONFIDENCE,
    );

    await runLane(stubLLM(SYNTHESIZED_RESEARCH));

    const written = await Observation.findOne({
      entityKey: SLUG,
      field: 'fullDescription',
      sourceName: FRA_PROFILE_SYNTHESIS_SOURCE_NAME,
    }).lean();
    expect(written?.confidence).toBe(FRA_PROFILE_SYNTHESIS_CONFIDENCE);
    expect(written?.sourceUrl).toBe(PROFILE_URL);
  });

  it('honors a manual lock on fullDescription before spending a fetch or an LLM call', async () => {
    await seedFra({ manuallyLockedFields: ['fullDescription'], fullDescription: PROFILE_BIO });
    const callLLM = vi.fn(stubLLM(SYNTHESIZED_RESEARCH));
    const fetchProfileText = vi.fn(async () => PROFILE_PAGE_TEXT);
    const entity = (await ResearchEntity.findOne({
      slug: SLUG,
    }).lean()) as FraProfileSynthesisEntity;

    const report = await runFraProfileSynthesisEntity({
      entity,
      profileUrl: PROFILE_URL,
      callLLM,
      fetchProfileText,
      apply: true,
      runId: 'locked',
      sourceId: 'locked',
    });

    expect(report).toMatchObject({ skipped: 'fullDescription-locked', written: false });
    expect(callLLM).not.toHaveBeenCalled();
    expect(fetchProfileText).not.toHaveBeenCalled();
    expect(
      await Observation.countDocuments({ sourceName: FRA_PROFILE_SYNTHESIS_SOURCE_NAME }),
    ).toBe(0);
    expect(selectFraProfileSynthesisTargets([entity])).toEqual([]);
  });

  it('skips an entity that already has a recorded non-bio research description', async () => {
    await seedFra();
    await seedFullDescriptionObservation(
      OFFICIAL_RESEARCH_STATEMENT,
      'ysm-faculty-directory',
      PROFILE_DESCRIPTION_CONFIDENCE,
    );
    const callLLM = vi.fn(stubLLM(SYNTHESIZED_RESEARCH));

    const report = await runLane(callLLM);

    expect(report).toMatchObject({ skipped: 'better-sourced-description', written: false });
    expect(callLLM).not.toHaveBeenCalled();
    expect(
      await Observation.countDocuments({ sourceName: FRA_PROFILE_SYNTHESIS_SOURCE_NAME }),
    ).toBe(0);
  });

  it('fails closed on a synthesis that keeps a dangling pronoun subject', async () => {
    await seedFra();
    await seedFullDescriptionObservation(
      PROFILE_BIO,
      'ysm-faculty-directory',
      PROFILE_DESCRIPTION_CONFIDENCE,
    );

    const report = await runLane(stubLLM(PRONOUN_LED_SYNTHESIS));

    expect(report).toMatchObject({
      synthesized: false,
      written: false,
      skipped: 'synthesized text keeps a dangling pronoun subject',
    });
    expect(
      await Observation.countDocuments({ sourceName: FRA_PROFILE_SYNTHESIS_SOURCE_NAME }),
    ).toBe(0);
  });

  it('refuses to write to a LAB minted from the same profile page', async () => {
    // The faculty-directory scrapers mint a LAB whenever the faculty member has a
    // lab site and stamp the same biography on it, so `--slug <that-lab>` reached
    // a cohort the seed source and coverage registry both declare out of scope.
    await seedFra({ entityType: 'LAB', fullDescription: PROFILE_BIO });
    const callLLM = vi.fn(stubLLM(SYNTHESIZED_RESEARCH));
    const fetchProfileText = vi.fn(async () => PROFILE_PAGE_TEXT);
    const entity = (await ResearchEntity.findOne({
      slug: SLUG,
    }).lean()) as FraProfileSynthesisEntity;

    const report = await runFraProfileSynthesisEntity({
      entity,
      profileUrl: PROFILE_URL,
      callLLM,
      fetchProfileText,
      apply: true,
      runId: 'out-of-scope',
      sourceId: 'out-of-scope',
    });

    expect(report).toMatchObject({ written: false });
    expect(report.skipped).toMatch(/out-of-scope/);
    expect(callLLM).not.toHaveBeenCalled();
    expect(fetchProfileText).not.toHaveBeenCalled();
    expect(selectFraProfileSynthesisTargets([entity])).toEqual([]);
  });

  it('leaves an archived entity out of scope', async () => {
    await seedFra({ archived: true, fullDescription: PROFILE_BIO });
    const entity = (await ResearchEntity.findOne({
      slug: SLUG,
    }).lean()) as FraProfileSynthesisEntity;
    expect(selectFraProfileSynthesisTargets([entity])).toEqual([]);
  });

  it('fails closed when pronoun repair drops the text back below the quality bar', async () => {
    await seedFra();
    await seedFullDescriptionObservation(
      PROFILE_BIO,
      'ysm-faculty-directory',
      PROFILE_DESCRIPTION_CONFIDENCE,
    );

    const report = await runLane(stubLLM(REPAIR_SHORTENED_SYNTHESIS));

    expect(report).toMatchObject({ synthesized: false, written: false });
    expect(report.skipped).toMatch(/quality bar/);
    expect(
      await Observation.countDocuments({ sourceName: FRA_PROFILE_SYNTHESIS_SOURCE_NAME }),
    ).toBe(0);
  });

  it('harvests research prose from a page whose research sentence contains an abbreviation', async () => {
    await seedFra();
    await seedFullDescriptionObservation(
      PROFILE_BIO,
      'ysm-faculty-directory',
      PROFILE_DESCRIPTION_CONFIDENCE,
    );

    const report = await runLane(stubLLM(SYNTHESIZED_RESEARCH));

    expect(report.snippets).toBeGreaterThan(0);
    expect(report.synthesized).toBe(true);
  });
});
