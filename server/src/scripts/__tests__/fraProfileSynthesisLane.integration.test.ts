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
import { isHighConfidencePersonBio } from '../../utils/researchHomeDescriptionSelection';
import type { CoverageSynthesisLLMFn } from '../../scrapers/coverageSynthesis';
import {
  FRA_PROFILE_SYNTHESIS_CONFIDENCE,
  FRA_PROFILE_SYNTHESIS_SOURCE_NAME,
  isCareerBiographyDescription,
} from '../fraProfileSynthesisCore';
import { Account } from '../../models/account';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import {
  fraProfileSynthesisLeads,
  newFraProfileSynthesisRunId,
  servedFullDescription,
  profileUrlsOf,
  runFraProfileSynthesisEntity,
  selectFraProfileSynthesisTargets,
  type FraProfileSynthesisEntity,
} from '../fraProfileSynthesisLane';

const SLUG = 'fra-profile-lane-fixture';
const PROFILE_URL = 'https://medicine.example.edu/profile/avery_lin/';

/**
 * The bare departmental contact stub an FRA is seeded from, and the lead's second
 * official profile that is never on the row's own sourceUrls (#1937).
 */
const DEPARTMENT_STUB_URL = 'https://mcdb.yale.edu/profile/avery-lin-phd';
const LEAD_SECONDARY_PROFILE_URL = 'https://medicine.yale.edu/profile/avery-lin/';
const STUB_PAGE_TEXT = [
  'YSM Home INFORMATION FOR Find People Organization Charts Departments & Centers',
  'Avery Lin, PhD. Professor of Molecular, Cellular and Developmental Biology.',
  'Office: 000 Example Street, New Haven. Appointments by arrangement only.',
].join(' ');
const LEAD = {
  name: 'Avery Lin',
  netid: 'al47',
  officialProfileUrls: [LEAD_SECONDARY_PROFILE_URL],
};

/**
 * A stored body the serve layer withholds as role-only, so the row serves no prose
 * while its `fullDescription` field is not empty. Deliberately not a career biography,
 * so only the served-text arm of selection can reach it.
 */
const ROLE_ONLY_STORED_BODY = 'Track Director of the Graduate Program in Molecular Biophysics.';

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

/**
 * A career biography that `isHighConfidencePersonBio` does not flag: no leading
 * pronoun, no "Dr." lead, no credentialed name, no degree narrative. It is the
 * cohort selection reaches on career facts, so the resolver has to demote it too
 * or the 0.55 directory bio outranks the 0.48 replacement forever.
 */
const NAME_LED_CAREER_BIO =
  'Avery Lin is an immunologist at Yale University, where she teaches in the graduate immunology program, mentors postdoctoral trainees, and advises undergraduates on research careers.';

/**
 * Useful by `fullDescriptionQuality` and carrying no career marker, yet it never
 * says what the research is. Treating it as a better-sourced description leaves
 * the entity with no research description at all.
 */
const CLINICAL_SERVICE_PROSE =
  'Lin sees patients in the digestive diseases clinic at Yale New Haven Hospital and serves on the hospital ethics committee, work she has continued since 2011.';

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
  options: { apply?: boolean; pageText?: string; runId?: string } = {},
) {
  const entity = (await ResearchEntity.findOne({ slug: SLUG }).lean()) as FraProfileSynthesisEntity;
  const source = await Source.findOne({ name: FRA_PROFILE_SYNTHESIS_SOURCE_NAME }).lean();
  return runFraProfileSynthesisEntity({
    entity,
    profileUrls: profileUrlsOf(entity),
    callLLM,
    fetchProfileText: async () => options.pageText ?? PROFILE_PAGE_TEXT,
    apply: options.apply ?? true,
    runId: options.runId ?? newFraProfileSynthesisRunId(),
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
    for (const name of [
      'observations',
      'research_entities',
      'sources',
      'role_assignments',
      'researchers',
      'accounts',
    ]) {
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

  it('persists the observation under the run id an --apply run constructs', async () => {
    // `scrapeRunId` is an ObjectId and observations insert unordered, so a run id
    // the CLI builds from a timestamp was dropped without throwing: the lane
    // reported written and the biography kept serving.
    await seedFra();
    await seedFullDescriptionObservation(
      PROFILE_BIO,
      'ysm-faculty-directory',
      PROFILE_DESCRIPTION_CONFIDENCE,
    );
    const runId = newFraProfileSynthesisRunId();

    const report = await runLane(stubLLM(SYNTHESIZED_RESEARCH), { runId });

    expect(report).toMatchObject({ synthesized: true, written: true });
    const written = await Observation.findOne({
      entityKey: SLUG,
      field: 'fullDescription',
      sourceName: FRA_PROFILE_SYNTHESIS_SOURCE_NAME,
    }).lean();
    expect(String(written?.scrapeRunId)).toBe(runId);
    const persisted = (await ResearchEntity.findOne({ slug: SLUG }).lean()) as Record<string, any>;
    expect(persisted.fullDescription).toBe(SYNTHESIZED_RESEARCH);
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
      profileUrls: [PROFILE_URL],
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

  it('skips an entity already serving a recorded non-bio research description', async () => {
    await seedFra({ fullDescription: OFFICIAL_RESEARCH_STATEMENT });
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

  it('proceeds when the better-sourced alternative is one the row does not actually serve', async () => {
    // "Already beats this lane" is a claim about a contest that has been held, and a
    // row serving nothing shows the recorded alternative did not win it, so reading
    // that alternative as a winner leaves the row blank forever.
    await seedFra({ fullDescription: '' });
    await seedFullDescriptionObservation(
      OFFICIAL_RESEARCH_STATEMENT,
      'ysm-faculty-directory',
      PROFILE_DESCRIPTION_CONFIDENCE,
    );
    const callLLM = vi.fn(stubLLM(SYNTHESIZED_RESEARCH));

    const report = await runLane(callLLM);

    expect(report.skipped).toBeUndefined();
    expect(callLLM).toHaveBeenCalledTimes(1);
    // The lane's own write is what this asserts, because the row unblanking is not
    // evidence on its own: the better alternative wins the resolver once the row is
    // materialized, which is the right outcome and exactly why standing down was
    // wrong, but it happens whether or not this lane recorded anything.
    expect(
      await Observation.countDocuments({ sourceName: FRA_PROFILE_SYNTHESIS_SOURCE_NAME }),
    ).toBe(1);
    const persisted = (await ResearchEntity.findOne({ slug: SLUG }).lean()) as Record<string, any>;
    const served = toPublicResearchEntityDto(persisted) as Record<string, any>;
    expect(served.fullDescription).toBeTruthy();
    expect(isHighConfidencePersonBio(served.fullDescription)).toBe(false);
  });

  it('brings a row storing a body the serve layer withholds into scope', async () => {
    // A row can store prose and still serve none of it: an appointment dump, a
    // role-only fragment or a contact route is blanked at serve time, so a predicate
    // reading the stored field decides the opposite of what a student sees.
    expect(isCareerBiographyDescription(ROLE_ONLY_STORED_BODY)).toBe(false);
    await seedFra({ fullDescription: ROLE_ONLY_STORED_BODY });
    const entity = (await ResearchEntity.findOne({
      slug: SLUG,
    }).lean()) as FraProfileSynthesisEntity;

    expect(servedFullDescription(entity)).toBe('');
    expect(selectFraProfileSynthesisTargets([entity])).toHaveLength(1);
  });

  it('does not stand down for a better-sourced description on a row whose body is withheld', async () => {
    await seedFra({ fullDescription: ROLE_ONLY_STORED_BODY });
    await seedFullDescriptionObservation(
      OFFICIAL_RESEARCH_STATEMENT,
      'ysm-faculty-directory',
      PROFILE_DESCRIPTION_CONFIDENCE,
    );
    const callLLM = vi.fn(stubLLM(SYNTHESIZED_RESEARCH));

    const report = await runLane(callLLM);

    expect(report.skipped).toBeUndefined();
    expect(callLLM).toHaveBeenCalledTimes(1);
  });

  it('proceeds when the recorded alternative is useful prose that never describes research', async () => {
    await seedFra();
    await seedFullDescriptionObservation(
      CLINICAL_SERVICE_PROSE,
      'ysm-faculty-directory',
      PROFILE_DESCRIPTION_CONFIDENCE,
    );
    const callLLM = vi.fn(stubLLM(SYNTHESIZED_RESEARCH));

    const report = await runLane(callLLM);

    expect(report.skipped).toBeUndefined();
    expect(report).toMatchObject({ synthesized: true, written: true });
    expect(callLLM).toHaveBeenCalledTimes(1);
  });

  it('displaces a served career biography that the person-voice check alone does not flag', async () => {
    expect(isHighConfidencePersonBio(NAME_LED_CAREER_BIO)).toBe(false);
    await seedFra();
    await seedFullDescriptionObservation(
      NAME_LED_CAREER_BIO,
      'ysm-faculty-directory',
      PROFILE_DESCRIPTION_CONFIDENCE,
    );
    await materializeEntity(
      'researchEntity',
      { entityKey: SLUG },
      { dryRun: false, synthesizeCardDescription: async () => '' },
    );
    const beforeLane = (await ResearchEntity.findOne({ slug: SLUG }).lean()) as Record<string, any>;
    expect(beforeLane.fullDescription).toBe(NAME_LED_CAREER_BIO);
    const entity = (await ResearchEntity.findOne({
      slug: SLUG,
    }).lean()) as FraProfileSynthesisEntity;
    expect(selectFraProfileSynthesisTargets([entity])).toHaveLength(1);

    const report = await runLane(stubLLM(SYNTHESIZED_RESEARCH));

    expect(report).toMatchObject({ synthesized: true, written: true });
    const persisted = (await ResearchEntity.findOne({ slug: SLUG }).lean()) as Record<string, any>;
    expect(persisted.fullDescription).toBe(SYNTHESIZED_RESEARCH);
    expect(persisted.fieldProvenance?.fullDescription?.sourceName).toBe(
      FRA_PROFILE_SYNTHESIS_SOURCE_NAME,
    );
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
      profileUrls: [PROFILE_URL],
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

  it('selects an entity whose only citation is a vanity person page', async () => {
    // art.yale.edu and law.yale.edu publish a person at the site root with no
    // `/profile/` segment anywhere in the path, so a literal match skipped whole
    // schools while the page carried exactly the research prose this lane needs
    // (#2276).
    await seedFra({
      fullDescription: NAME_LED_CAREER_BIO,
      sourceUrls: ['https://law.yale.edu/avery-lin'],
    });
    const entity = (await ResearchEntity.findOne({
      slug: SLUG,
    }).lean()) as FraProfileSynthesisEntity;

    expect(profileUrlsOf(entity)).toEqual(['https://law.yale.edu/avery-lin']);
    expect(selectFraProfileSynthesisTargets([entity])).toHaveLength(1);
  });

  it('reads a school-specific person path through the lead name when the row is titled otherwise', async () => {
    await seedFra({
      name: 'Undergraduate Research',
      fullDescription: NAME_LED_CAREER_BIO,
      sourceUrls: ['https://som.yale.edu/faculty-research/faculty-directory/avery-r-lin'],
    });
    const entity = {
      ...((await ResearchEntity.findOne({ slug: SLUG }).lean()) as FraProfileSynthesisEntity),
      leads: [{ name: 'Avery R. Lin, Ph.D.', netid: '', officialProfileUrls: [] }],
    };

    expect(profileUrlsOf(entity)).toEqual([
      'https://som.yale.edu/faculty-research/faculty-directory/avery-r-lin',
    ]);
    expect(selectFraProfileSynthesisTargets([entity])).toHaveLength(1);
  });

  it('leaves out an entity whose only citation is its department roster', async () => {
    // A roster page is nobody's own profile, so synthesizing from it would
    // describe one person with the whole department's prose.
    await seedFra({
      fullDescription: NAME_LED_CAREER_BIO,
      sourceUrls: ['https://law.yale.edu/faculty-directory', 'https://law.yale.edu/people/'],
    });
    const entity = (await ResearchEntity.findOne({
      slug: SLUG,
    }).lean()) as FraProfileSynthesisEntity;

    expect(profileUrlsOf(entity)).toEqual([]);
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

  it('brings an empty description into scope so a row that serves no card can be described', async () => {
    // Selection keyed on a career biography, so a row with no description at all was
    // out of scope by construction: the only lane that could describe it never looked
    // at it (#1937).
    await seedFra({ fullDescription: '' });
    const entity = (await ResearchEntity.findOne({
      slug: SLUG,
    }).lean()) as FraProfileSynthesisEntity;

    expect(selectFraProfileSynthesisTargets([entity])).toHaveLength(1);
  });

  it("reads the lead's second official profile when the cited departmental stub carries no research prose", async () => {
    await seedFra({ fullDescription: '', sourceUrls: [DEPARTMENT_STUB_URL] });
    const entity = {
      ...((await ResearchEntity.findOne({ slug: SLUG }).lean()) as FraProfileSynthesisEntity),
      leads: [LEAD],
    };
    const source = await Source.findOne({ name: FRA_PROFILE_SYNTHESIS_SOURCE_NAME }).lean();
    const fetched: string[] = [];

    expect(profileUrlsOf(entity)).toEqual([DEPARTMENT_STUB_URL, LEAD_SECONDARY_PROFILE_URL]);
    const report = await runFraProfileSynthesisEntity({
      entity,
      profileUrls: profileUrlsOf(entity),
      callLLM: stubLLM(SYNTHESIZED_RESEARCH),
      fetchProfileText: async (url) => {
        fetched.push(url);
        return url === LEAD_SECONDARY_PROFILE_URL ? PROFILE_PAGE_TEXT : STUB_PAGE_TEXT;
      },
      apply: true,
      runId: newFraProfileSynthesisRunId(),
      sourceId: String(source?._id ?? ''),
    });

    expect(fetched).toEqual([DEPARTMENT_STUB_URL, LEAD_SECONDARY_PROFILE_URL]);
    expect(report).toMatchObject({
      synthesized: true,
      written: true,
      sourceUrl: LEAD_SECONDARY_PROFILE_URL,
    });
    const persisted = (await ResearchEntity.findOne({ slug: SLUG }).lean()) as Record<string, any>;
    expect(persisted.fullDescription).toBe(SYNTHESIZED_RESEARCH);
    expect(persisted.fieldProvenance?.fullDescription?.sourceUrl).toBe(LEAD_SECONDARY_PROFILE_URL);
    const served = toPublicResearchEntityDto(persisted) as Record<string, any>;
    expect(served.fullDescription).toBe(SYNTHESIZED_RESEARCH);
  });

  it('reports the snippet count and the gate reason from the same candidate', async () => {
    // Taking the count from the page that carried prose and the reason from a page
    // that carried none prints a row describing no real page, which is the #2440
    // family of a lane counter that misreports its own outcome.
    await seedFra({ fullDescription: '', sourceUrls: [DEPARTMENT_STUB_URL] });
    const entity = {
      ...((await ResearchEntity.findOne({ slug: SLUG }).lean()) as FraProfileSynthesisEntity),
      leads: [LEAD],
    };

    const report = await runFraProfileSynthesisEntity({
      entity,
      profileUrls: profileUrlsOf(entity),
      callLLM: stubLLM(PRONOUN_LED_SYNTHESIS),
      fetchProfileText: async (url) =>
        url === LEAD_SECONDARY_PROFILE_URL ? PROFILE_PAGE_TEXT : STUB_PAGE_TEXT,
      apply: false,
      runId: 'dry-run',
    });

    expect(report).toMatchObject({
      synthesized: false,
      skipped: 'synthesized text keeps a dangling pronoun subject',
    });
    expect(report.snippets).toBeGreaterThan(0);
  });

  it('stops at the first page that yields a usable description', async () => {
    await seedFra({ fullDescription: '', sourceUrls: [DEPARTMENT_STUB_URL] });
    const entity = {
      ...((await ResearchEntity.findOne({ slug: SLUG }).lean()) as FraProfileSynthesisEntity),
      leads: [LEAD],
    };
    const fetchProfileText = vi.fn(async () => PROFILE_PAGE_TEXT);

    const report = await runFraProfileSynthesisEntity({
      entity,
      profileUrls: profileUrlsOf(entity),
      callLLM: stubLLM(SYNTHESIZED_RESEARCH),
      fetchProfileText,
      apply: false,
      runId: 'dry-run',
    });

    expect(report).toMatchObject({ synthesized: true, sourceUrl: DEPARTMENT_STUB_URL });
    expect(fetchProfileText).toHaveBeenCalledTimes(1);
  });

  it('reports the candidate that mattered rather than the last one tried', async () => {
    // The report and the CLI's `skipped` tally are the only instrument this lane has,
    // so a later candidate that never loaded must not erase the snippet count and the
    // gate that are the real reason nothing was written (#2440).
    await seedFra({ fullDescription: '', sourceUrls: [DEPARTMENT_STUB_URL] });
    const entity = {
      ...((await ResearchEntity.findOne({ slug: SLUG }).lean()) as FraProfileSynthesisEntity),
      leads: [LEAD],
    };

    const report = await runFraProfileSynthesisEntity({
      entity,
      profileUrls: profileUrlsOf(entity),
      callLLM: stubLLM(PRONOUN_LED_SYNTHESIS),
      fetchProfileText: async (url) => {
        if (url === LEAD_SECONDARY_PROFILE_URL) throw new Error('profile page is down');
        return PROFILE_PAGE_TEXT;
      },
      apply: false,
      runId: 'dry-run',
    });

    expect(report).toMatchObject({
      synthesized: false,
      skipped: 'synthesized text keeps a dangling pronoun subject',
    });
    expect(report.snippets).toBeGreaterThan(0);
  });

  it("offers a lead's verified official profile and withholds one recorded unavailable", async () => {
    const entity = await seedFra({ fullDescription: '', sourceUrls: [DEPARTMENT_STUB_URL] });
    const account = await Account.create({
      netid: 'al47',
      email: 'al47@example.edu',
    });
    const [live, dead, trainee] = await Researcher.create([
      {
        displayName: 'Avery Lin',
        accountId: account._id,
        profileLinks: [
          {
            kind: 'YALE_OFFICIAL',
            purpose: 'PRIMARY_IDENTITY',
            url: LEAD_SECONDARY_PROFILE_URL,
            verifiedAt: new Date(),
            healthStatus: 'HEALTHY',
          },
        ],
      },
      {
        displayName: 'Jordan Quincy',
        profileLinks: [
          {
            kind: 'YALE_OFFICIAL',
            purpose: 'PRIMARY_IDENTITY',
            url: 'https://medicine.yale.edu/profile/jordan-quincy/',
            verifiedAt: new Date(),
            healthStatus: 'UNAVAILABLE',
          },
        ],
      },
      {
        displayName: 'Sasha Reyes',
        profileLinks: [
          {
            kind: 'YALE_OFFICIAL',
            purpose: 'PRIMARY_IDENTITY',
            url: 'https://medicine.yale.edu/profile/sasha-reyes/',
            verifiedAt: new Date(),
            healthStatus: 'HEALTHY',
          },
        ],
      },
    ]);
    await RoleAssignment.create([
      {
        personId: live._id,
        target: { kind: 'RESEARCH_ENTITY', id: entity._id },
        role: 'PI',
        state: 'CURRENT',
        confidence: 0.9,
      },
      {
        personId: dead._id,
        target: { kind: 'RESEARCH_ENTITY', id: entity._id },
        role: 'CO_PI',
        state: 'CURRENT',
        confidence: 0.9,
      },
      {
        personId: trainee._id,
        target: { kind: 'RESEARCH_ENTITY', id: entity._id },
        role: 'GRADUATE_STUDENT',
        state: 'CURRENT',
        confidence: 0.9,
      },
    ]);

    const leadsByEntityId = await fraProfileSynthesisLeads([{ _id: entity._id }]);
    const leads = leadsByEntityId.get(String(entity._id)) ?? [];

    expect(Object.fromEntries(leads.map((lead) => [lead.name, lead.officialProfileUrls]))).toEqual({
      'Avery Lin': [LEAD_SECONDARY_PROFILE_URL],
      'Jordan Quincy': [],
    });
    expect(
      profileUrlsOf({
        ...((await ResearchEntity.findOne({ slug: SLUG }).lean()) as FraProfileSynthesisEntity),
        leads,
      }),
    ).toEqual([DEPARTMENT_STUB_URL, LEAD_SECONDARY_PROFILE_URL]);
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
