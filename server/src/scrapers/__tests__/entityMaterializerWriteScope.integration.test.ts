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

vi.mock('../accessMaterializer', async () => {
  const actual =
    await vi.importActual<typeof import('../accessMaterializer')>('../accessMaterializer');
  return {
    ...actual,
    materializeAccessForResearchGroup: vi.fn(actual.materializeAccessForResearchGroup),
  };
});

import { Observation } from '../../models/observation';
import { OrgUnit } from '../../models/orgUnit';
import { ResearchEntity } from '../../models/researchEntity';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { Source } from '../../models/source';
import { materializeAccessForResearchGroup } from '../accessMaterializer';
import {
  LEAD_PI_SCHOOL_INHERITANCE_SOURCE,
  inheritSchoolFromLeadPi,
  materializeEntity,
} from '../entityMaterializer';
import { resetOrgUnitCanonicalizerCache } from '../orgUnitCanonicalization';

const ENTITY_KEY = 'write-scope-fixture';
const RENAMED = 'Write Scope Fixture Research Lab';

describe('a materialize pass scoped by writeOnlyFields writes only its scope (#3874)', () => {
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
    for (const name of [
      'org_units',
      'research_entities',
      'researchers',
      'role_assignments',
      'observations',
      'sources',
    ]) {
      await db.collection(name).deleteMany({});
    }
    const medicine = await OrgUnit.create({
      slug: 'school-of-medicine',
      name: 'School of Medicine',
      kind: 'SCHOOL',
      status: 'ACTIVE',
    });
    await OrgUnit.create({
      slug: 'genetics',
      name: 'Genetics',
      kind: 'DEPARTMENT',
      parentOrgUnitId: medicine._id,
      status: 'ACTIVE',
    });
    resetOrgUnitCanonicalizerCache();
    await Source.create({
      name: LEAD_PI_SCHOOL_INHERITANCE_SOURCE,
      displayName: 'Lead PI school inheritance',
      defaultWeight: 0.6,
    });
  });

  const seedRenamableShell = async () => {
    const entity = await ResearchEntity.create({
      slug: ENTITY_KEY,
      name: 'Write Scope Fixture Lab',
      kind: 'lab',
      archived: false,
    });
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: ENTITY_KEY,
      field: 'name',
      value: RENAMED,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'department-directory',
      sourceUrl: 'https://example.edu/lab/write-scope',
      confidence: 0.95,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: false,
    });
    return entity._id as mongoose.Types.ObjectId;
  };

  const seedLead = async (entityId: mongoose.Types.ObjectId) => {
    const researcher = await Researcher.create({
      displayName: 'Fixture Lead',
      profile: { primaryDepartment: 'Genetics' },
    });
    await RoleAssignment.create({
      personId: researcher._id,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role: 'PI',
      state: 'CURRENT',
      confidence: 0.9,
    });
  };

  const persisted = async (id: unknown) =>
    (await ResearchEntity.findById(id).lean()) as Record<string, any>;

  const inheritanceObservations = () =>
    Observation.countDocuments({ sourceName: LEAD_PI_SCHOOL_INHERITANCE_SOURCE });

  describe('lead-PI school inheritance', () => {
    it('neither asserts nor writes the org unit through a pass scoped away from it', async () => {
      const entityId = await seedRenamableShell();
      await seedLead(entityId);

      await materializeEntity(
        'researchEntity',
        { entityKey: ENTITY_KEY },
        { writeOnlyFields: ['name'] },
      );

      const after = await persisted(entityId);
      expect(after.name).toBe(RENAMED);
      expect(after.departments ?? []).toEqual([]);
      expect(after.school ?? '').toBe('');
      expect(after.fieldProvenance?.departments).toBeUndefined();
      expect(await inheritanceObservations()).toBe(0);
    });

    it('still inherits through a pass whose scope names the org unit', async () => {
      const entityId = await seedRenamableShell();
      await seedLead(entityId);

      await materializeEntity(
        'researchEntity',
        { entityKey: ENTITY_KEY },
        { writeOnlyFields: ['name', 'departments'] },
      );

      const after = await persisted(entityId);
      expect(after.departments).toEqual(['Genetics']);
      expect(after.school).toBe('School of Medicine');
      expect(await inheritanceObservations()).toBeGreaterThan(0);
    });

    it('still inherits through an unscoped pass', async () => {
      const entityId = await seedRenamableShell();
      await seedLead(entityId);

      await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

      expect((await persisted(entityId)).departments).toEqual(['Genetics']);
    });

    it('reports the scope as the reason when called directly with one', async () => {
      const entityId = await seedRenamableShell();
      await seedLead(entityId);

      const result = await inheritSchoolFromLeadPi(String(entityId), {
        writeOnlyFields: ['researchAreas'],
      });

      expect(result).toEqual({ inherited: false, skipped: 'out-of-scope' });
      expect(await inheritanceObservations()).toBe(0);
    });
  });

  describe('lead membership and access signals', () => {
    const seedInferredPi = async () => {
      const researcher = await Researcher.create({
        displayName: 'Fixture Inferred Lead',
        profileLinks: [],
        archived: false,
      });
      await Observation.create({
        entityType: 'researchEntity',
        entityKey: ENTITY_KEY,
        field: 'inferredPiUserId',
        value: researcher._id.toString(),
        sourceId: new mongoose.Types.ObjectId(),
        sourceName: 'ysm-atoz-index',
        sourceUrl: 'https://example.edu/lab/write-scope',
        confidence: 0.84,
        observedAt: new Date('2026-01-01T00:00:00Z'),
        superseded: false,
      });
    };

    it('mints no lead edge and upserts no access signal through a scoped pass', async () => {
      const entityId = await seedRenamableShell();
      await seedInferredPi();

      await materializeEntity(
        'researchEntity',
        { entityKey: ENTITY_KEY },
        { writeOnlyFields: ['name'] },
      );

      expect((await persisted(entityId)).name).toBe(RENAMED);
      expect(await RoleAssignment.countDocuments({ 'target.id': entityId })).toBe(0);
      expect(materializeAccessForResearchGroup).not.toHaveBeenCalled();
    });

    it('keeps the lead edge and access signals on a scoped pass that asks for them', async () => {
      const entityId = await seedRenamableShell();
      await seedInferredPi();

      await materializeEntity(
        'researchEntity',
        { entityKey: ENTITY_KEY },
        { writeOnlyFields: ['name'], keepPostProjectionEvidence: true },
      );

      expect((await persisted(entityId)).name).toBe(RENAMED);
      expect(await RoleAssignment.countDocuments({ 'target.id': entityId, role: 'PI' })).toBe(1);
      expect(materializeAccessForResearchGroup).toHaveBeenCalledTimes(1);
    });

    it('mints the lead edge and derives access signals through an unscoped pass', async () => {
      const entityId = await seedRenamableShell();
      await seedInferredPi();

      await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

      expect(await RoleAssignment.countDocuments({ 'target.id': entityId, role: 'PI' })).toBe(1);
      expect(materializeAccessForResearchGroup).toHaveBeenCalledTimes(1);
    });
  });
});
