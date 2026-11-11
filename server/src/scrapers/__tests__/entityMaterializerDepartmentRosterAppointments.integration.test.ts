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
import { fieldValueRefusalKey } from '../../utils/researchEntityFieldValueRefusals';

const ROSTER = 'dept-faculty-roster';
const RECENT = new Date('2026-09-20T00:00:00Z');
const LAST_TERM = new Date('2026-06-01T00:00:00Z');
const SCOPED_RUN = new Date('2026-10-09T00:00:00Z');
const AFTER_SCOPED_RUN = new Date('2026-10-10T00:00:00Z');

describe('department roster appointments combine (#3621)', () => {
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
    const arts = await OrgUnit.create({
      slug: 'faculty-of-arts-and-sciences',
      name: 'Faculty of Arts and Sciences',
      kind: 'DIVISION',
      status: 'ACTIVE',
      aliases: ['Yale Faculty of Arts and Sciences'],
    });
    for (const [slug, name, aliases] of [
      ['history', 'History', []],
      [
        'history-of-science-medicine',
        'History of Science & Medicine',
        ['History of Science, Medicine & Public Health'],
      ],
      ['early-modern-studies', 'Early Modern Studies', []],
      ['medieval-studies', 'Medieval Studies', []],
    ] as const) {
      await OrgUnit.create({
        slug,
        name,
        kind: 'DEPARTMENT',
        parentOrgUnitId: arts._id,
        status: 'ACTIVE',
        aliases: [...aliases],
      });
    }
    resetOrgUnitCanonicalizerCache();
  });

  const seedRosterRead = (entityKey: string, departments: string[], observedAt = RECENT) =>
    Observation.create({
      entityType: 'researchEntity',
      entityKey,
      field: 'departments',
      value: departments,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: ROSTER,
      sourceUrl: `https://${departments[0].toLowerCase().replace(/[^a-z]+/g, '-')}.example.yale.edu/people/`,
      confidence: 0.7,
      observedAt,
      superseded: false,
    });

  const seedRosterSnapshot = (
    deptKey: string,
    deptName: string,
    discoveredEntityKeys: string[],
    readAt: Date,
    overrides: Record<string, unknown> = {},
  ) =>
    Observation.create({
      entityType: 'departmentRosterHealth',
      entityKey: deptKey,
      field: 'departmentRosterHealth',
      value: {
        deptKey,
        deptName,
        status: 'ok',
        complete: true,
        discoveredCount: discoveredEntityKeys.length,
        discoveredEntityKeys,
        read: {
          pagesRead: 1,
          readMode: 'html',
          cacheAllowed: false,
          pagesReusedWithinSweep: 0,
          readAt: readAt.toISOString(),
        },
        ...overrides,
      },
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: ROSTER,
      sourceUrl: `https://${deptKey}.example.yale.edu/people/`,
      confidence: 0.7,
      observedAt: readAt,
      superseded: false,
    });

  const seedMergedIn = (survivorId: unknown, slug = 'example-lead-roster-shell') =>
    ResearchEntity.create({
      slug,
      name: 'Example Lead Faculty Research',
      archived: true,
      canonicalGroupId: survivorId,
    });

  const seedName = (entityKey: string) =>
    Observation.create({
      entityType: 'researchEntity',
      entityKey,
      field: 'name',
      value: 'Example Lead Faculty Research',
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'lab-microsite',
      sourceUrl: `https://example.yale.edu/${entityKey}/`,
      confidence: 0.9,
      observedAt: RECENT,
      superseded: false,
    });

  const seedRow = (slug: string, departments: string[] = [], extra: Record<string, unknown> = {}) =>
    ResearchEntity.create({
      slug,
      name: 'Example Lead Faculty Research',
      kind: 'individual',
      archived: false,
      departments,
      ...extra,
    });

  const departmentsOf = async (slug: string) =>
    ((await ResearchEntity.findOne({ slug }).lean<{ departments?: string[] }>()) ?? {}).departments;

  it('keeps every department page that currently lists the person, home department first', async () => {
    await seedRow('example-lead', ['History of Science & Medicine']);
    await seedName('example-lead');
    await seedRosterRead(
      'example-lead',
      ['History of Science, Medicine & Public Health'],
      LAST_TERM,
    );
    await seedRosterRead('example-lead', ['History of Science, Medicine & Public Health']);
    await seedRosterRead('example-lead', ['History']);

    await materializeEntity('researchEntity', { entityKey: 'example-lead' });
    expect(await departmentsOf('example-lead')).toEqual([
      'History of Science & Medicine',
      'History',
    ]);

    await materializeEntity('researchEntity', { entityKey: 'example-lead' });
    expect(await departmentsOf('example-lead')).toEqual([
      'History of Science & Medicine',
      'History',
    ]);
  });

  it('projects the same combined list from the survivor key and a merged-in key', async () => {
    const survivor = await seedRow('example-lead', ['History of Science & Medicine']);
    await ResearchEntity.create({
      slug: 'example-lead-roster-shell',
      name: 'Example Lead Faculty Research',
      archived: true,
      canonicalGroupId: survivor._id,
    });
    await seedName('example-lead');
    await seedRosterRead('example-lead', ['History']);
    await seedRosterRead('example-lead-roster-shell', [
      'History of Science, Medicine & Public Health',
    ]);

    await materializeEntity('researchEntity', { entityKey: 'example-lead' });
    const fromSurvivorKey = await departmentsOf('example-lead');
    await materializeEntity('researchEntity', { entityKey: 'example-lead-roster-shell' });
    const fromLoserKey = await departmentsOf('example-lead');
    await materializeEntity('researchEntity', { entityKey: 'example-lead' });

    expect(fromSurvivorKey).toEqual(['History of Science & Medicine', 'History']);
    expect(fromLoserKey).toEqual(fromSurvivorKey);
    expect(await departmentsOf('example-lead')).toEqual(fromSurvivorKey);
    expect(
      (
        await ResearchEntity.findOne({ slug: 'example-lead-roster-shell' }).lean<{
          archived?: boolean;
        }>()
      )?.archived,
    ).toBe(true);
  });

  it('never lets a merged-in roster read outrank a department the survivor holds', async () => {
    const survivor = await seedRow('example-lead', ['Early Modern Studies']);
    await ResearchEntity.create({
      slug: 'example-lead-roster-shell',
      name: 'Example Lead Faculty Research',
      archived: true,
      canonicalGroupId: survivor._id,
    });
    await seedName('example-lead');
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: 'example-lead',
      field: 'departments',
      value: ['Early Modern Studies'],
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'lab-microsite',
      sourceUrl: 'https://example.yale.edu/example-lead/',
      confidence: 0.9,
      observedAt: RECENT,
      superseded: false,
    });
    await seedRosterRead('example-lead', ['History']);
    await seedRosterRead('example-lead-roster-shell', ['History']);

    await materializeEntity('researchEntity', { entityKey: 'example-lead' });

    expect(await departmentsOf('example-lead')).toEqual(['Early Modern Studies']);
  });

  it('never combines a school label from a roster page', async () => {
    await seedRow('example-lead', ['History'], { school: 'Faculty of Arts and Sciences' });
    await seedName('example-lead');
    await seedRosterRead('example-lead', ['History']);
    await seedRosterRead('example-lead', ['Yale Faculty of Arts and Sciences']);

    await materializeEntity('researchEntity', { entityKey: 'example-lead' });

    expect(await departmentsOf('example-lead')).toEqual(['History']);
  });

  it('drops a page that stopped listing the person', async () => {
    await seedRow('example-lead', ['History', 'Early Modern Studies']);
    await seedName('example-lead');
    await seedRosterRead('example-lead', ['History']);
    await seedRosterRead('example-lead', ['Early Modern Studies'], LAST_TERM);
    await seedRosterSnapshot(
      'early-modern-studies',
      'Early Modern Studies',
      ['another-faculty-member'],
      SCOPED_RUN,
    );

    await materializeEntity('researchEntity', { entityKey: 'example-lead' });

    expect(await departmentsOf('example-lead')).toEqual(['History']);
  });

  describe("a merged-in row's appointment whose roster was not read again (#5824)", () => {
    const seedCrossListing = async (stored: string[] = ['History', 'Early Modern Studies']) => {
      const survivor = await seedRow('example-lead', stored);
      await seedMergedIn(survivor._id);
      await seedName('example-lead');
      await seedRosterRead('example-lead', ['History']);
      return survivor;
    };

    it('keeps the appointment when a scoped run read only the home roster', async () => {
      await seedCrossListing();
      await seedRosterRead('example-lead-roster-shell', ['Early Modern Studies'], LAST_TERM);
      await seedRosterSnapshot('history', 'History', ['example-lead'], RECENT);

      await materializeEntity('researchEntity', { entityKey: 'example-lead' });

      expect(await departmentsOf('example-lead')).toEqual(['History', 'Early Modern Studies']);
    });

    it('adds the appointment to a survivor that does not store it yet', async () => {
      await seedCrossListing(['History']);
      await seedRosterRead('example-lead-roster-shell', ['Early Modern Studies'], LAST_TERM);

      await materializeEntity('researchEntity', { entityKey: 'example-lead' });

      expect(await departmentsOf('example-lead')).toEqual(['History', 'Early Modern Studies']);
    });

    it('reads the merged-in appointment whichever identity form it is filed under', async () => {
      const survivor = await seedCrossListing(['History']);
      const byId = await seedMergedIn(survivor._id, 'example-lead-id-shell');
      await seedRosterRead('example-lead-roster-shell', ['Early Modern Studies'], LAST_TERM);
      await Observation.create({
        entityType: 'researchEntity',
        entityId: byId._id,
        field: 'departments',
        value: ['Medieval Studies'],
        sourceId: new mongoose.Types.ObjectId(),
        sourceName: ROSTER,
        sourceUrl: 'https://medieval.example.yale.edu/people/',
        confidence: 0.7,
        observedAt: LAST_TERM,
        superseded: false,
      });

      await materializeEntity('researchEntity', { entityKey: 'example-lead' });

      expect(await departmentsOf('example-lead')).toEqual([
        'History',
        'Early Modern Studies',
        'Medieval Studies',
      ]);
    });

    it('keeps the appointment while the later read of its roster still lists the merged-in key', async () => {
      await seedCrossListing();
      await seedRosterRead('example-lead-roster-shell', ['Early Modern Studies'], LAST_TERM);
      await seedRosterSnapshot(
        'early-modern-studies',
        'Early Modern Studies',
        ['example-lead-roster-shell'],
        SCOPED_RUN,
      );

      await materializeEntity('researchEntity', { entityKey: 'example-lead' });

      expect(await departmentsOf('example-lead')).toEqual(['History', 'Early Modern Studies']);
    });

    it('drops the appointment once its own roster is read in full without the row', async () => {
      await seedCrossListing();
      await seedRosterRead('example-lead-roster-shell', ['Early Modern Studies'], LAST_TERM);
      await seedRosterSnapshot(
        'early-modern-studies',
        'Early Modern Studies',
        ['another-faculty-member'],
        SCOPED_RUN,
      );

      await materializeEntity('researchEntity', { entityKey: 'example-lead' });

      expect(await departmentsOf('example-lead')).toEqual(['History']);
    });

    it('judges the appointment by the newest complete read of its roster', async () => {
      await seedCrossListing();
      await seedRosterRead('example-lead-roster-shell', ['Early Modern Studies'], LAST_TERM);
      await seedRosterSnapshot(
        'early-modern-studies',
        'Early Modern Studies',
        ['example-lead-roster-shell'],
        new Date(LAST_TERM.getTime() + 60_000),
      );
      await seedRosterSnapshot(
        'early-modern-studies',
        'Early Modern Studies',
        ['another-faculty-member'],
        SCOPED_RUN,
      );

      await materializeEntity('researchEntity', { entityKey: 'example-lead' });

      expect(await departmentsOf('example-lead')).toEqual(['History']);
    });

    it('treats an incomplete read of its roster as no evidence of absence', async () => {
      await seedCrossListing();
      await seedRosterRead('example-lead-roster-shell', ['Early Modern Studies'], LAST_TERM);
      await seedRosterSnapshot(
        'early-modern-studies',
        'Early Modern Studies',
        ['another-faculty-member'],
        SCOPED_RUN,
        { status: 'partial-read', complete: false },
      );

      await materializeEntity('researchEntity', { entityKey: 'example-lead' });

      expect(await departmentsOf('example-lead')).toEqual(['History', 'Early Modern Studies']);
    });

    it('never resurrects a superseded appointment on a merged-in row', async () => {
      await seedCrossListing(['History']);
      const retired = await seedRosterRead(
        'example-lead-roster-shell',
        ['Early Modern Studies'],
        LAST_TERM,
      );
      await Observation.updateOne({ _id: retired._id }, { $set: { superseded: true } });

      await materializeEntity('researchEntity', { entityKey: 'example-lead' });

      expect(await departmentsOf('example-lead')).toEqual(['History']);
    });

    it('keeps a refused appointment refused', async () => {
      await seedCrossListing(['History']);
      await ResearchEntity.updateOne(
        { slug: 'example-lead' },
        {
          $set: {
            fieldValueRefusals: {
              departments: [
                {
                  valueKey: fieldValueRefusalKey('departments', ['Early Modern Studies']),
                  rule: 'operator_judgement',
                  refusedBy: 'research-entity:refuse-field-value',
                  refusedAt: AFTER_SCOPED_RUN,
                },
              ],
            },
          },
        },
      );
      await seedRosterRead('example-lead-roster-shell', ['Early Modern Studies'], LAST_TERM);

      await materializeEntity('researchEntity', { entityKey: 'example-lead' });

      expect(await departmentsOf('example-lead')).toEqual(['History']);
    });

    it('never takes an appointment from a row that is not merged in', async () => {
      await seedCrossListing(['History']);
      await seedRow('unrelated-faculty-member', ['Early Modern Studies']);
      await seedRosterRead('unrelated-faculty-member', ['Early Modern Studies'], LAST_TERM);

      await materializeEntity('researchEntity', { entityKey: 'example-lead' });

      expect(await departmentsOf('example-lead')).toEqual(['History']);
    });

    it('derives the same list on every resolve', async () => {
      await seedCrossListing();
      await seedRosterRead('example-lead-roster-shell', ['Early Modern Studies'], LAST_TERM);

      await materializeEntity('researchEntity', { entityKey: 'example-lead' });
      const first = await departmentsOf('example-lead');
      await materializeEntity('researchEntity', { entityKey: 'example-lead-roster-shell' });
      await materializeEntity('researchEntity', { entityKey: 'example-lead' });

      expect(first).toEqual(['History', 'Early Modern Studies']);
      expect(await departmentsOf('example-lead')).toEqual(first);
    });
  });

  it('drops a superseded roster value', async () => {
    await seedRow('example-lead', ['History']);
    await seedName('example-lead');
    await seedRosterRead('example-lead', ['History']);
    const retired = await seedRosterRead('example-lead', ['Early Modern Studies']);
    await Observation.updateOne({ _id: retired._id }, { $set: { superseded: true } });

    await materializeEntity('researchEntity', { entityKey: 'example-lead' });

    expect(await departmentsOf('example-lead')).toEqual(['History']);
  });
});
