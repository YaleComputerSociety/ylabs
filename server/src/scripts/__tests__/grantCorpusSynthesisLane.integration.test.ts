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
import { OrgUnit } from '../../models/orgUnit';
import { ResearchEntity } from '../../models/researchEntity';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { Source } from '../../models/source';
import { appendObservations, getSourceByName } from '../../scrapers/observationStore';
import {
  synthesizeCoverageDescription,
  type CoverageSynthesisLLMFn,
} from '../../scrapers/coverageSynthesis';
import {
  materializeEntity,
  materializationReadScopeFilter,
} from '../../scrapers/entityMaterializer';
import { resetOrgUnitCanonicalizerCache } from '../../scrapers/orgUnitCanonicalization';
import { toPublicResearchEntityDto } from '../../services/researchEntityDto';
import {
  GRANT_CORPUS_DESCRIPTION_CONFIDENCE,
  GRANT_CORPUS_SYNTHESIS_SOURCE_NAME,
  buildGrantCorpusSnippets,
  entityHasBetterSourcedDescription,
  fullDescriptionObservationFilter,
  type FullDescriptionObservationLike,
} from '../grantCorpusSynthesisCore';

const SLUG = 'grant-corpus-lane-fixture';

const GRANT_ABSTRACT_DESCRIPTION_CONFIDENCE = 0.35;

const RECENT_GRANTS = [
  {
    id: 'R01-1',
    agency: 'NIH',
    title: 'Mechanisms of hippocampal memory consolidation',
    abstract:
      'This project investigates how hippocampal circuits consolidate spatial memory during sleep, using in vivo electrophysiology and optogenetic manipulation in mice to identify the synaptic mechanisms that stabilize newly encoded representations.',
    url: 'https://reporter.nih.gov/project/R01-1',
    role: 'pi',
  },
  {
    id: 'NSF-2',
    agency: 'NSF',
    title: 'Computational models of synaptic plasticity',
    abstract:
      'Develops computational models of synaptic plasticity that predict how recurrent cortical networks learn sequences, validated against large-scale calcium imaging datasets.',
    url: 'https://nsf.gov/awardsearch/showAward?AWD_ID=NSF-2',
    role: 'pi',
  },
  {
    id: 'R01-3',
    agency: 'NIH',
    title: 'Sleep-dependent replay in cortical circuits',
    abstract:
      'Examines sleep-dependent replay of neural activity in cortical circuits and its role in generalizing learned associations, combining high-density recordings with closed-loop stimulation.',
    url: 'https://reporter.nih.gov/project/R01-3',
    role: 'pi',
  },
];

const CORPUS_LEVEL_DESCRIPTION =
  'Investigates how hippocampal and cortical circuits consolidate memory during sleep, combining in vivo electrophysiology, optogenetic manipulation, high-density recordings, and calcium imaging with computational models of synaptic plasticity to understand sleep-dependent replay and how recurrent cortical networks learn sequences.';

const UNGROUNDED_DESCRIPTION =
  'This world-class research group pursues transformative discoveries at the frontier of knowledge and trains the next generation of outstanding scientific leaders across many exciting disciplines.';

const OFFICIAL_PROFILE_DESCRIPTION =
  'The Lin Laboratory studies how epithelial tissues repair themselves after injury, using organoid culture, live imaging, and single-cell sequencing to map the signaling circuits that coordinate collective cell behavior during regeneration.';

const stubLLM = (fullDescription: string): CoverageSynthesisLLMFn => async ({ snippets }) => ({
  fullDescription,
  usedSnippetIndexes: snippets.map((_snippet, index) => index),
});

interface LaneOutcome {
  slug: string;
  grants: number;
  snippets: number;
  synthesized: boolean;
  written: boolean;
  gainedSchool: boolean;
  school?: string;
  description?: string;
  sourceUrls?: string[];
  skipped?: string;
}

/**
 * Mirrors the per-entity body of `research-entity:grant-corpus-synthesis`
 * (server/src/scripts/grantCorpusSynthesis.ts) against a real database, with the
 * OpenAI call replaced by a stub so the lane's own guards, write path, and
 * materialize pass are the code under test.
 */
async function runGrantCorpusLane(callLLM: CoverageSynthesisLLMFn): Promise<LaneOutcome> {
  const entity = (await ResearchEntity.findOne({ slug: SLUG }).lean()) as Record<string, any>;
  const outcome: LaneOutcome = {
    slug: entity.slug,
    grants: Array.isArray(entity.recentGrants) ? entity.recentGrants.length : 0,
    snippets: 0,
    synthesized: false,
    written: false,
    gainedSchool: false,
  };

  const manuallyLockedFields: string[] = Array.isArray(entity.manuallyLockedFields)
    ? entity.manuallyLockedFields
    : [];
  if (manuallyLockedFields.includes('fullDescription')) {
    outcome.skipped = 'fullDescription-locked';
    return outcome;
  }

  const fullDescriptionObservations = (await Observation.find(
    fullDescriptionObservationFilter({
      entityKey: entity.slug,
      entityId: entity._id,
      readScope: materializationReadScopeFilter(),
    }),
  )
    .select('value sourceName')
    .lean()) as unknown as FullDescriptionObservationLike[];
  if (
    entityHasBetterSourcedDescription(
      fullDescriptionObservations,
      entity.researchAreas,
      entity.entityType,
    )
  ) {
    outcome.skipped = 'better-sourced-description';
    return outcome;
  }

  const snippets = buildGrantCorpusSnippets(entity.recentGrants);
  outcome.snippets = snippets.length;
  if (snippets.length === 0) {
    outcome.skipped = 'no-grant-text';
    return outcome;
  }

  const result = await synthesizeCoverageDescription({
    snippets,
    entityName: typeof entity.name === 'string' ? entity.name : '',
    entityType: entity.entityType,
    researchAreas: entity.researchAreas,
    callLLM,
  });
  if (!result) {
    outcome.skipped = 'synthesis-failed-quality-gate';
    return outcome;
  }
  outcome.synthesized = true;
  outcome.description = result.description;
  outcome.sourceUrls = result.sourceUrls;

  const source = await getSourceByName(GRANT_CORPUS_SYNTHESIS_SOURCE_NAME);
  if (!source) throw new Error('grant-corpus-synthesis-llm source is not seeded');
  await appendObservations(
    [
      {
        entityType: 'researchEntity',
        entityKey: entity.slug,
        field: 'fullDescription',
        value: result.description,
        sourceUrl: result.sourceUrls[0],
        confidenceOverride: GRANT_CORPUS_DESCRIPTION_CONFIDENCE,
      },
    ],
    {
      scrapeRunId: new mongoose.Types.ObjectId().toString(),
      sourceId: source._id,
      sourceName: GRANT_CORPUS_SYNTHESIS_SOURCE_NAME,
      sourceWeight: GRANT_CORPUS_DESCRIPTION_CONFIDENCE,
      dryRun: false,
    },
  );
  outcome.written = true;

  const beforeSchool = typeof entity.school === 'string' ? entity.school.trim() : '';
  await materializeEntity(
    'researchEntity',
    { entityKey: entity.slug },
    { dryRun: false, synthesizeCardDescription: async () => '' },
  );
  const fresh = (await ResearchEntity.findOne({ slug: SLUG }).lean()) as Record<string, any>;
  const afterSchool = typeof fresh?.school === 'string' ? fresh.school.trim() : '';
  if (!beforeSchool && afterSchool) {
    outcome.gainedSchool = true;
    outcome.school = afterSchool;
  }
  return outcome;
}

describe('grant-corpus research synthesis + PI-to-school inheritance lane (#2158)', () => {
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
      'org_units',
      'research_entities',
      'researchers',
      'role_assignments',
      'sources',
      'admin_access_review_projections',
    ]) {
      await db.collection(name).deleteMany({});
    }

    await Source.create([
      {
        name: GRANT_CORPUS_SYNTHESIS_SOURCE_NAME,
        displayName: 'Grant-corpus research synthesis LLM',
        defaultWeight: GRANT_CORPUS_DESCRIPTION_CONFIDENCE,
      },
      { name: 'nih-reporter', displayName: 'NIH RePORTER', defaultWeight: 0.8 },
      {
        name: 'lab-microsite-description-llm',
        displayName: 'Lab microsite description LLM',
        defaultWeight: 0.75,
      },
    ]);

    const medicine = await OrgUnit.create({
      slug: 'school-of-medicine',
      name: 'School of Medicine',
      kind: 'SCHOOL',
      status: 'ACTIVE',
    });
    await OrgUnit.create({
      slug: 'neuroscience',
      name: 'Neuroscience',
      kind: 'DEPARTMENT',
      parentOrgUnitId: medicine._id,
      status: 'ACTIVE',
    });
    resetOrgUnitCanonicalizerCache();
  });

  const seedGrantShell = async (overrides: Record<string, unknown> = {}) =>
    ResearchEntity.create({
      slug: SLUG,
      name: 'Lin Laboratory',
      kind: 'lab',
      entityType: 'LAB',
      studentVisibilityTier: 'operator_review',
      archived: false,
      school: '',
      schools: [],
      departments: [],
      recentGrants: RECENT_GRANTS,
      recentGrantCount: RECENT_GRANTS.length,
      ...overrides,
    });

  const seedLeadPi = async (researchEntityId: mongoose.Types.ObjectId) => {
    const researcher = await Researcher.create({
      displayName: 'Avery Lin',
      profile: { primaryDepartment: 'Neuroscience' },
    });
    await RoleAssignment.create({
      personId: researcher._id,
      target: { kind: 'RESEARCH_ENTITY', id: researchEntityId },
      role: 'PI',
      state: 'CURRENT',
      confidence: 0.9,
    });
  };

  const seedFullDescriptionObservation = async (
    value: string,
    sourceName: string,
    confidence: number,
  ) => {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: SLUG,
      field: 'fullDescription',
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName,
      sourceUrl: `https://example.edu/${sourceName}/`,
      confidence,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: false,
    });
  };

  it('gives a grant-backed PI shell a corpus-level description and its lead PI school in one pass', async () => {
    const entity = await seedGrantShell();
    await seedLeadPi(entity._id);
    await seedFullDescriptionObservation(
      RECENT_GRANTS[0].abstract,
      'nih-reporter',
      GRANT_ABSTRACT_DESCRIPTION_CONFIDENCE,
    );

    const outcome = await runGrantCorpusLane(stubLLM(CORPUS_LEVEL_DESCRIPTION));

    expect(outcome).toMatchObject({
      snippets: 3,
      synthesized: true,
      written: true,
      gainedSchool: true,
      school: 'School of Medicine',
    });
    expect(outcome.sourceUrls).toEqual(RECENT_GRANTS.map((grant) => grant.url));

    const persisted = (await ResearchEntity.findOne({ slug: SLUG }).lean()) as Record<string, any>;
    expect(persisted.fullDescription).toBe(CORPUS_LEVEL_DESCRIPTION);
    expect(persisted.fieldProvenance?.fullDescription?.sourceName).toBe(
      GRANT_CORPUS_SYNTHESIS_SOURCE_NAME,
    );
    const writtenObservation = await Observation.findOne({
      entityKey: SLUG,
      field: 'fullDescription',
      sourceName: GRANT_CORPUS_SYNTHESIS_SOURCE_NAME,
    }).lean();
    expect(writtenObservation?.confidence).toBe(GRANT_CORPUS_DESCRIPTION_CONFIDENCE);
    expect(persisted.school).toBe('School of Medicine');
    expect(persisted.schools).toEqual(['School of Medicine']);
    expect(persisted.departments).toEqual(['Neuroscience']);

    const served = toPublicResearchEntityDto(persisted) as Record<string, any>;
    expect(served.fullDescription).toBe(CORPUS_LEVEL_DESCRIPTION);
    expect(served.school).toBe('School of Medicine');
  });

  it('outranks the single-abstract grant fallback that was the entity description before', async () => {
    const entity = await seedGrantShell();
    await seedLeadPi(entity._id);
    await seedFullDescriptionObservation(
      RECENT_GRANTS[0].abstract,
      'nih-reporter',
      GRANT_ABSTRACT_DESCRIPTION_CONFIDENCE,
    );

    await materializeEntity(
      'researchEntity',
      { entityKey: SLUG },
      { dryRun: false, synthesizeCardDescription: async () => '' },
    );
    const beforeLane = (await ResearchEntity.findOne({ slug: SLUG }).lean()) as Record<string, any>;
    expect(beforeLane.fullDescription).toBe(RECENT_GRANTS[0].abstract);

    await runGrantCorpusLane(stubLLM(CORPUS_LEVEL_DESCRIPTION));

    const afterLane = (await ResearchEntity.findOne({ slug: SLUG }).lean()) as Record<string, any>;
    expect(afterLane.fullDescription).toBe(CORPUS_LEVEL_DESCRIPTION);
  });

  it('loses to an official-profile description, which is skipped before any LLM call', async () => {
    const entity = await seedGrantShell();
    await seedLeadPi(entity._id);
    await seedFullDescriptionObservation(
      OFFICIAL_PROFILE_DESCRIPTION,
      'lab-microsite-description-llm',
      0.75,
    );
    const callLLM = vi.fn(stubLLM(CORPUS_LEVEL_DESCRIPTION));

    const outcome = await runGrantCorpusLane(callLLM);

    expect(outcome).toMatchObject({ skipped: 'better-sourced-description', written: false });
    expect(callLLM).not.toHaveBeenCalled();
    expect(
      await Observation.countDocuments({ sourceName: GRANT_CORPUS_SYNTHESIS_SOURCE_NAME }),
    ).toBe(0);

    await materializeEntity(
      'researchEntity',
      { entityKey: SLUG },
      { dryRun: false, synthesizeCardDescription: async () => '' },
    );
    const persisted = (await ResearchEntity.findOne({ slug: SLUG }).lean()) as Record<string, any>;
    expect(persisted.fullDescription).toBe(OFFICIAL_PROFILE_DESCRIPTION);
  });

  it('fails closed on an ungrounded synthesis, writing no observation and no school', async () => {
    const entity = await seedGrantShell();
    await seedLeadPi(entity._id);

    const outcome = await runGrantCorpusLane(stubLLM(UNGROUNDED_DESCRIPTION));

    expect(outcome).toMatchObject({
      synthesized: false,
      written: false,
      skipped: 'synthesis-failed-quality-gate',
    });
    expect(
      await Observation.countDocuments({ sourceName: GRANT_CORPUS_SYNTHESIS_SOURCE_NAME }),
    ).toBe(0);
    const persisted = (await ResearchEntity.findOne({ slug: SLUG }).lean()) as Record<string, any>;
    expect(persisted.fullDescription ?? '').toBe('');
    expect(persisted.school ?? '').toBe('');
  });

  it('honors a manual lock on fullDescription', async () => {
    const entity = await seedGrantShell({ manuallyLockedFields: ['fullDescription'] });
    await seedLeadPi(entity._id);

    const outcome = await runGrantCorpusLane(stubLLM(CORPUS_LEVEL_DESCRIPTION));

    expect(outcome).toMatchObject({ skipped: 'fullDescription-locked', written: false });
    expect(
      await Observation.countDocuments({ sourceName: GRANT_CORPUS_SYNTHESIS_SOURCE_NAME }),
    ).toBe(0);
  });
});
