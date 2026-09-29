import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { OrgUnit } from '../../models/orgUnit';
import { ResearchEntity } from '../../models/researchEntity';
import { materializeEntity } from '../entityMaterializer';
import { resetOrgUnitCanonicalizerCache } from '../orgUnitCanonicalization';

type StoredDepartments = {
  departments?: string[];
  orgAffiliationLabels?: string[];
  fieldProvenance?: { departments?: { sourceName?: string } };
};

describe('a department winner that names no department (#3610)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    resetOrgUnitCanonicalizerCache();
    await mongoose.disconnect();
    await replSet?.stop();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities', 'org_units']) {
      await db.collection(name).deleteMany({});
    }
    const publicHealth = await OrgUnit.create({
      slug: 'school-of-public-health',
      name: 'School of Public Health',
      kind: 'SCHOOL',
      status: 'ACTIVE',
      aliases: ['Yale School of Public Health'],
    });
    await OrgUnit.create({
      slug: 'biostatistics',
      name: 'Biostatistics',
      kind: 'DEPARTMENT',
      parentOrgUnitId: publicHealth._id,
      status: 'ACTIVE',
    });
    await OrgUnit.create({
      slug: 'faculty-of-arts-and-sciences',
      name: 'Faculty of Arts and Sciences',
      kind: 'DIVISION',
      status: 'ACTIVE',
    });
    await OrgUnit.create({
      slug: 'economics',
      name: 'Economics',
      kind: 'DEPARTMENT',
      status: 'ACTIVE',
    });
    resetOrgUnitCanonicalizerCache();
  });

  const seedObservation = async (
    entityKey: string,
    field: string,
    value: unknown,
    sourceName: string,
    confidence: number,
  ) => {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey,
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName,
      sourceUrl: `https://example.yale.edu/${sourceName}/${entityKey}/`,
      confidence,
      observedAt: new Date('2026-02-01T00:00:00Z'),
      superseded: false,
    });
  };

  const stored = async (slug: string) =>
    (await ResearchEntity.findOne({ slug }).lean<StoredDepartments>()) ?? {};

  const seedRow = (slug: string, departments: string[] = []) =>
    ResearchEntity.create({
      slug,
      name: 'Example Lead Lab',
      kind: 'lab',
      archived: false,
      departments,
    });

  it('adopts a lower-confidence real department over a school-level roster label', async () => {
    await seedRow('example-lead-lab', ['Biostatistics']);
    await seedObservation('example-lead-lab', 'name', 'Example Lead Lab', 'lab-microsite', 0.9);
    await seedObservation(
      'example-lead-lab',
      'departments',
      ['Yale School of Public Health'],
      'dept-faculty-roster',
      0.7,
    );
    await seedObservation(
      'example-lead-lab',
      'departments',
      ['Biostatistics'],
      'lead-pi-school-inheritance',
      0.6,
    );

    await materializeEntity('researchEntity', { entityKey: 'example-lead-lab' });

    const after = await stored('example-lead-lab');
    expect(after.departments).toEqual(['Biostatistics']);
    expect(after.fieldProvenance?.departments?.sourceName).toBe('lead-pi-school-inheritance');
  });

  it('leaves the stored department when every observation names no department', async () => {
    await seedRow('example-lead-lab', ['Economics']);
    await seedObservation('example-lead-lab', 'name', 'Example Lead Lab', 'lab-microsite', 0.9);
    await seedObservation(
      'example-lead-lab',
      'departments',
      ['PUBLIC HEALTH & PREV MEDICINE'],
      'nih-reporter',
      0.4,
    );

    await materializeEntity('researchEntity', { entityKey: 'example-lead-lab' });
    await materializeEntity('researchEntity', { entityKey: 'example-lead-lab' });

    expect((await stored('example-lead-lab')).departments).toEqual(['Economics']);
  });

  it("leaves the stored department when the winner names only the row's own school", async () => {
    await ResearchEntity.create({
      slug: 'example-lead-lab',
      name: 'Example Lead Lab',
      kind: 'lab',
      archived: false,
      school: 'Faculty of Arts and Sciences',
      departments: ['Economics'],
    });
    await seedObservation('example-lead-lab', 'name', 'Example Lead Lab', 'lab-microsite', 0.9);
    await seedObservation(
      'example-lead-lab',
      'departments',
      ['Faculty of Arts and Sciences'],
      'dept-faculty-roster',
      0.7,
    );

    await materializeEntity('researchEntity', { entityKey: 'example-lead-lab' });
    await materializeEntity('researchEntity', { entityKey: 'example-lead-lab' });

    expect((await stored('example-lead-lab')).departments).toEqual(['Economics']);
  });

  it('still records a non-department label as search text on a row with no department', async () => {
    await seedRow('example-lead-lab');
    await seedObservation('example-lead-lab', 'name', 'Example Lead Lab', 'lab-microsite', 0.9);
    await seedObservation(
      'example-lead-lab',
      'departments',
      ['Example Imaging Center'],
      'dept-faculty-roster',
      0.7,
    );

    await materializeEntity('researchEntity', { entityKey: 'example-lead-lab' });

    const after = await stored('example-lead-lab');
    expect(after.departments ?? []).toEqual([]);
    expect(after.orgAffiliationLabels).toEqual(['Example Imaging Center']);
  });

  it("lets a merged-in loser's real department fill past a survivor label that names none", async () => {
    const survivor = await seedRow('example-lead-lab');
    await ResearchEntity.create({
      slug: 'dept-economics-example-lead',
      name: 'Example Lead',
      kind: 'individual',
      archived: true,
      canonicalGroupId: survivor._id,
    });
    await seedObservation('example-lead-lab', 'name', 'Example Lead Lab', 'lab-microsite', 0.9);
    await seedObservation(
      'example-lead-lab',
      'departments',
      ['PUBLIC HEALTH & PREV MEDICINE'],
      'nih-reporter',
      0.4,
    );
    await seedObservation(
      'dept-economics-example-lead',
      'departments',
      ['Economics'],
      'dept-faculty-roster',
      0.7,
    );

    await materializeEntity('researchEntity', { entityKey: 'example-lead-lab' });
    expect((await stored('example-lead-lab')).departments).toEqual(['Economics']);

    await materializeEntity('researchEntity', { entityKey: 'dept-economics-example-lead' });
    expect((await stored('example-lead-lab')).departments).toEqual(['Economics']);
  });
});
