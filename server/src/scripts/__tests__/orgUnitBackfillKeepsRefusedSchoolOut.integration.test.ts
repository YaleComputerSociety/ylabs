import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', () => ({
  syncEntities: vi.fn(async () => {}),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
}));

import { OrgUnit } from '../../models/orgUnit';
import { ResearchEntity } from '../../models/researchEntity';
import { resetOrgUnitCanonicalizerCache } from '../../scrapers/orgUnitCanonicalization';
import { runOrgUnitBackfill } from '../backfillResearchEntityOrgUnits';

const REFUSED_SCHOOL = 'Synthetic School of Alpha';
const OTHER_SCHOOL = 'Synthetic School of Beta';
const ALPHA_DEPARTMENT = 'Synthetic Alpha Studies';
const BETA_DEPARTMENT = 'Synthetic Beta Studies';

describe('research-homes:backfill-org-units keeps a refused school out (#6155)', () => {
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
    const db = mongoose.connection.db;
    if (!db) throw new Error('no database connection');
    await Promise.all([
      db.collection('research_entities').deleteMany({}),
      db.collection('org_units').deleteMany({}),
    ]);
    resetOrgUnitCanonicalizerCache();
    const alpha = await OrgUnit.create({
      slug: 'synthetic-alpha-school',
      name: REFUSED_SCHOOL,
      kind: 'SCHOOL',
      status: 'ACTIVE',
    });
    const beta = await OrgUnit.create({
      slug: 'synthetic-beta-school',
      name: OTHER_SCHOOL,
      kind: 'SCHOOL',
      status: 'ACTIVE',
    });
    await OrgUnit.create({
      slug: 'synthetic-alpha-dept',
      name: ALPHA_DEPARTMENT,
      kind: 'DEPARTMENT',
      status: 'ACTIVE',
      parentOrgUnitId: alpha._id,
    });
    await OrgUnit.create({
      slug: 'synthetic-beta-dept',
      name: BETA_DEPARTMENT,
      kind: 'DEPARTMENT',
      status: 'ACTIVE',
      parentOrgUnitId: beta._id,
    });
    await db.collection('research_entities').insertOne({
      slug: 'synthetic-refused-school-row',
      name: 'Synthetic Refused School Row',
      kind: 'lab',
      entityType: 'LAB',
      archived: false,
      schools: [OTHER_SCHOOL],
      departments: [ALPHA_DEPARTMENT, BETA_DEPARTMENT],
      fieldValueRefusals: {
        school: [
          {
            valueKey: REFUSED_SCHOOL.toLowerCase(),
            rule: 'operator_judgement',
            refusedBy: 'synthetic reviewer',
            refusedAt: new Date('2026-11-01T00:00:00.000Z'),
            note: 'synthetic refusal',
          },
        ],
      },
    });
  });

  it('does not re-add a refused school that a stored department derives', async () => {
    const dryRun = await runOrgUnitBackfill({ dryRun: true, batchSize: 50 });
    expect(dryRun.sampleChanges).toEqual([]);

    await runOrgUnitBackfill({ dryRun: false, batchSize: 50 });
    const stored = await ResearchEntity.findOne({ slug: 'synthetic-refused-school-row' }).lean<
      Record<string, unknown>
    >();
    expect(stored?.schools).toEqual([OTHER_SCHOOL]);
    expect(stored?.school).toBeUndefined();
  });
});
