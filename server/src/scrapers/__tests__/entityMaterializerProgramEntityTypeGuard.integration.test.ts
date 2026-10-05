import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntity: vi.fn().mockResolvedValue(undefined),
  deleteFromIndex: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntity: meiliMocks.syncEntity,
    deleteFromIndex: meiliMocks.deleteFromIndex,
  };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { PROGRAM_LIVES_ON_PROGRAMS_ARCHIVE_REASON } from '../../models/entityArchival';
import {
  healedEntityTypeForRetiredProgramObservations,
  isRetiredProgramResearchEntityType,
  materializeEntity,
  winningObservedEntityTypeIsRetiredProgram,
  withHealedRetiredProgramEntityType,
} from '../entityMaterializer';

describe('materializeEntity refuses to mint or resurrect a PROGRAM research entity', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities', 'fellowships']) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedObservation = async (
    entityKey: string,
    field: string,
    value: unknown,
    overrides: { observedAt?: Date; confidence?: number } = {},
  ): Promise<void> => {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey,
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'yale-research-official',
      sourceUrl: 'https://research.example.edu/program/example/',
      confidence: overrides.confidence ?? 0.9,
      observedAt: overrides.observedAt ?? new Date('2026-02-01T00:00:00Z'),
      superseded: false,
    });
  };

  it('classifies a PROGRAM entityType observation as retired', () => {
    expect(isRetiredProgramResearchEntityType('PROGRAM')).toBe(true);
    expect(isRetiredProgramResearchEntityType(' program ')).toBe(true);
    expect(isRetiredProgramResearchEntityType('LAB')).toBe(false);
  });

  it('asks only what the projection would resolve as the winning entityType', () => {
    const observation = (
      value: string,
      daysAgo: number,
    ): {
      field: string;
      value: string;
      sourceName: string;
      confidence: number;
      observedAt: Date;
    } => ({
      field: 'entityType',
      value,
      sourceName: 'yale-research-official',
      confidence: 0.9,
      observedAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
    });

    expect(winningObservedEntityTypeIsRetiredProgram([observation('PROGRAM', 180)])).toBe(true);
    expect(winningObservedEntityTypeIsRetiredProgram([observation('LAB', 180)])).toBe(false);
    expect(winningObservedEntityTypeIsRetiredProgram([])).toBe(false);
    expect(
      winningObservedEntityTypeIsRetiredProgram([
        observation('PROGRAM', 180),
        observation('INITIATIVE', 1),
      ]),
    ).toBe(false);
  });

  it('heals a retired PROGRAM assertion from a research-structure kind rather than dropping the entity (#2206)', () => {
    const kindObservation = (value: string) => ({
      field: 'kind',
      value,
      sourceName: 'department-undergrad-research',
      confidence: 0.8,
      observedAt: new Date('2026-08-24T00:00:00Z'),
    });

    expect(healedEntityTypeForRetiredProgramObservations([kindObservation('lab')])).toBe('LAB');
    expect(healedEntityTypeForRetiredProgramObservations([kindObservation('individual')])).toBe(
      'FACULTY_RESEARCH_AREA',
    );
  });

  it('fails closed instead of defaulting an unusable kind to LAB (#2206)', () => {
    const kindObservation = (value: unknown) => ({
      field: 'kind',
      value,
      sourceName: 'department-undergrad-research',
      confidence: 0.8,
      observedAt: new Date('2026-08-24T00:00:00Z'),
    });

    expect(healedEntityTypeForRetiredProgramObservations([])).toBeUndefined();
    expect(healedEntityTypeForRetiredProgramObservations([kindObservation('')])).toBeUndefined();
    expect(
      healedEntityTypeForRetiredProgramObservations([kindObservation('not-a-kind')]),
    ).toBeUndefined();
    expect(healedEntityTypeForRetiredProgramObservations([kindObservation(null)])).toBeUndefined();
  });

  it('rewrites only the retired entityType observations and leaves the rest alone', () => {
    const base = { sourceName: 'x', confidence: 0.9, observedAt: new Date() };
    const healed = withHealedRetiredProgramEntityType(
      [
        { ...base, field: 'entityType', value: 'PROGRAM' },
        { ...base, field: 'entityType', value: 'LAB' },
        { ...base, field: 'name', value: 'PROGRAM' },
      ],
      'INITIATIVE',
    );

    expect(healed.map((o) => o.value)).toEqual(['INITIATIVE', 'LAB', 'PROGRAM']);
  });

  it('treats a program kind as confirming the retired type, never healing it (#3746)', () => {
    expect(
      healedEntityTypeForRetiredProgramObservations([
        {
          field: 'kind',
          value: 'program',
          sourceName: 'department-undergrad-research',
          confidence: 0.8,
          observedAt: new Date('2026-08-24T00:00:00Z'),
        },
      ]),
    ).toBeUndefined();
  });

  it('mints no research entity for a department pathway its source classified as a program (#3746)', async () => {
    await seedObservation(
      'department-undergrad-research-psychology',
      'name',
      'Psychology Undergraduate Research Opportunities',
    );
    await seedObservation('department-undergrad-research-psychology', 'entityType', 'PROGRAM');
    await seedObservation('department-undergrad-research-psychology', 'kind', 'program');

    const result = await materializeEntity('researchEntity', {
      entityKey: 'department-undergrad-research-psychology',
    });

    expect(result.skipped).toBe('program-entity-type-retired');
    expect(result.created).toBe(false);
    await expect(
      ResearchEntity.countDocuments({ slug: 'department-undergrad-research-psychology' }),
    ).resolves.toBe(0);
  });

  it('mints a PI lab whose stale entityType said PROGRAM but whose kind said lab (#2206)', async () => {
    await seedObservation('nih-pi-example-researcher', 'name', 'Example Researcher Lab');
    await seedObservation('nih-pi-example-researcher', 'entityType', 'PROGRAM', {
      confidence: 0.96,
    });
    await seedObservation('nih-pi-example-researcher', 'kind', 'lab');

    const result = await materializeEntity('researchEntity', {
      entityKey: 'nih-pi-example-researcher',
    });

    expect(result.created).toBe(true);
    const doc = await ResearchEntity.findOne({ slug: 'nih-pi-example-researcher' }).lean<{
      entityType?: string;
    }>();
    expect(doc?.entityType).toBe('LAB');
  });

  it('skips minting a new research entity when observations assert entityType PROGRAM', async () => {
    await seedObservation('program-example-initiative', 'name', 'Example Program Initiative');
    await seedObservation('program-example-initiative', 'entityType', 'PROGRAM');

    const result = await materializeEntity('researchEntity', {
      entityKey: 'program-example-initiative',
    });

    expect(result.skipped).toBe('program-entity-type-retired');
    expect(result.created).toBe(false);
    expect(result.fieldsWritten).toBe(0);
    expect(meiliMocks.syncEntity).not.toHaveBeenCalled();
    await expect(
      ResearchEntity.countDocuments({ slug: 'program-example-initiative' }),
    ).resolves.toBe(0);
  });

  it('does not resurrect or re-sync an existing PROGRAM research entity', async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    await db.collection('research_entities').insertOne({
      _id: new mongoose.Types.ObjectId(),
      slug: 'program-legacy-residue',
      name: 'Legacy Program Residue',
      kind: 'program',
      entityType: 'PROGRAM',
      archived: true,
    });
    await seedObservation('program-legacy-residue', 'name', 'Legacy Program Residue Renamed');

    const result = await materializeEntity('researchEntity', {
      entityKey: 'program-legacy-residue',
    });

    expect(result.skipped).toBe('program-entity-type-retired');
    expect(result.fieldsWritten).toBe(0);
    expect(meiliMocks.syncEntity).not.toHaveBeenCalled();

    const doc = await ResearchEntity.findOne({ slug: 'program-legacy-residue' }).lean<{
      archived?: boolean;
      name?: string;
    }>();
    expect(doc?.archived).toBe(true);
    expect(doc?.name).toBe('Legacy Program Residue');
  });

  it('keeps materializing a live entity whose type healed away from PROGRAM', async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    await db.collection('research_entities').insertOne({
      _id: new mongoose.Types.ObjectId(),
      slug: 'center-macmillan-example',
      name: 'MacMillan Example Sub-program',
      kind: 'center',
      entityType: 'INITIATIVE',
      archived: false,
    });
    await seedObservation('center-macmillan-example', 'entityType', 'PROGRAM', {
      observedAt: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000),
    });
    await seedObservation('center-macmillan-example', 'entityType', 'INITIATIVE', {
      observedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
    await seedObservation(
      'center-macmillan-example',
      'name',
      'MacMillan Example Research Initiative',
      { observedAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    );

    const result = await materializeEntity('researchEntity', {
      entityKey: 'center-macmillan-example',
    });

    expect(result.skipped).not.toBe('program-entity-type-retired');
    expect(result.fieldsWritten).toBeGreaterThan(0);

    const doc = await ResearchEntity.findOne({ slug: 'center-macmillan-example' }).lean<{
      entityType?: string;
      name?: string;
    }>();
    expect(doc?.entityType).toBe('INITIATIVE');
    expect(doc?.name).toBe('MacMillan Example Research Initiative');
  });

  it('still materializes a valid non-PROGRAM research entity', async () => {
    await seedObservation('lab-example-genetics', 'name', 'Example Genetics Lab');
    await seedObservation('lab-example-genetics', 'kind', 'lab');

    const result = await materializeEntity('researchEntity', {
      entityKey: 'lab-example-genetics',
    });

    expect(result.skipped).not.toBe('program-entity-type-retired');
    expect(result.created).toBe(true);
  });
  describe('a research row whose program lives on /programs (#3746)', () => {
    const pathwayKey = 'department-undergrad-research-example-pathway';

    const seedFellowship = async (archived: boolean): Promise<void> => {
      const db = mongoose.connection.db;
      if (!db) throw new Error('no db');
      await db.collection('fellowships').insertOne({
        _id: new mongoose.Types.ObjectId(),
        sourceKey: pathwayKey,
        title: 'Example Pathway Undergraduate Research',
        archived,
      });
    };

    const seedLiveInitiative = async (): Promise<mongoose.Types.ObjectId> => {
      const db = mongoose.connection.db;
      if (!db) throw new Error('no db');
      const _id = new mongoose.Types.ObjectId();
      await db.collection('research_entities').insertOne({
        _id,
        slug: pathwayKey,
        name: 'Example Pathway Undergraduate Research',
        kind: 'initiative',
        entityType: 'INITIATIVE',
        archived: false,
        studentVisibilityTier: 'student_ready',
      });
      return _id;
    };

    const seedProgramTypedEvidence = async (): Promise<void> => {
      await seedObservation(pathwayKey, 'name', 'Example Pathway Undergraduate Research');
      await seedObservation(pathwayKey, 'entityType', 'PROGRAM');
    };

    const storedRow = () =>
      ResearchEntity.findOne({ slug: pathwayKey }).lean<{
        archived?: boolean;
        archivedReason?: string;
        studentVisibilityTier?: string;
      }>();

    it('archives the research row with an attributed reason and removes it from search', async () => {
      const id = await seedLiveInitiative();
      await seedProgramTypedEvidence();
      await seedFellowship(false);

      const result = await materializeEntity('researchEntity', { entityKey: pathwayKey });

      expect(result.skipped).toBe('program-lives-on-programs');
      const doc = await storedRow();
      expect(doc?.archived).toBe(true);
      expect(doc?.archivedReason).toBe(PROGRAM_LIVES_ON_PROGRAMS_ARCHIVE_REASON);
      expect(doc?.studentVisibilityTier).toBeUndefined();
      expect(meiliMocks.deleteFromIndex).toHaveBeenCalledWith('researchEntity', String(id));
      expect(meiliMocks.syncEntity).not.toHaveBeenCalled();
    });

    it('re-derives the same answer on a second run without writing or reviving the row', async () => {
      await seedLiveInitiative();
      await seedProgramTypedEvidence();
      await seedFellowship(false);
      await materializeEntity('researchEntity', { entityKey: pathwayKey });
      vi.clearAllMocks();

      const second = await materializeEntity('researchEntity', { entityKey: pathwayKey });

      expect(second.skipped).toBe('program-lives-on-programs');
      expect(second.fieldsWritten).toBe(0);
      expect(meiliMocks.syncEntity).not.toHaveBeenCalled();
      expect((await storedRow())?.archived).toBe(true);
    });

    it('plans the archive on a dry run without writing it', async () => {
      await seedLiveInitiative();
      await seedProgramTypedEvidence();
      await seedFellowship(false);

      const result = await materializeEntity(
        'researchEntity',
        { entityKey: pathwayKey },
        { dryRun: true },
      );

      expect(result.skipped).toBe('program-lives-on-programs');
      expect(result.plannedSet).toMatchObject({
        archived: true,
        archivedReason: PROGRAM_LIVES_ON_PROGRAMS_ARCHIVE_REASON,
      });
      expect((await storedRow())?.archived).toBe(false);
      expect(meiliMocks.deleteFromIndex).not.toHaveBeenCalled();
    });

    it('mints nothing for program-typed evidence whose program already lives on /programs', async () => {
      await seedProgramTypedEvidence();
      await seedObservation(pathwayKey, 'kind', 'center');
      await seedFellowship(false);

      const result = await materializeEntity('researchEntity', { entityKey: pathwayKey });

      expect(result.skipped).toBe('program-lives-on-programs');
      expect(result.created).toBe(false);
      await expect(ResearchEntity.countDocuments({ slug: pathwayKey })).resolves.toBe(0);
    });

    it('keeps the research row live when its program has no live record on /programs', async () => {
      await seedLiveInitiative();
      await seedProgramTypedEvidence();
      await seedFellowship(true);

      const result = await materializeEntity('researchEntity', { entityKey: pathwayKey });

      expect(result.skipped).not.toBe('program-lives-on-programs');
      expect((await storedRow())?.archived).toBe(false);
      expect(meiliMocks.deleteFromIndex).not.toHaveBeenCalled();
    });
  });
});
