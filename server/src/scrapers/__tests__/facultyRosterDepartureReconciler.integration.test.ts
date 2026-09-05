import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const probeSourceLink = vi.fn();
vi.mock('../../services/sourceLinkHealth', async () => {
  const actual = await vi.importActual<typeof import('../../services/sourceLinkHealth')>(
    '../../services/sourceLinkHealth',
  );
  return { ...actual, probeSourceLink: (url: string) => probeSourceLink(url) };
});

import { Observation } from '../../models/observation';
import { OrgUnit } from '../../models/orgUnit';
import { ResearchEntity } from '../../models/researchEntity';
import { resetOrgUnitCanonicalizerCache } from '../orgUnitCanonicalization';
import {
  DEPARTMENT_ROSTER_HEALTH_FIELD,
  reconcileFacultyRosterDeparturesFromRun,
} from '../facultyRosterDepartureReconciler';

const priorRun = new mongoose.Types.ObjectId().toString();
const DEAD = { status: 404 };
const ALIVE = { status: 200 };

const readEntity = (slug: string): Promise<any> =>
  ResearchEntity.findOne({ slug }).lean() as Promise<any>;

describe('reconcileFacultyRosterDeparturesFromRun (corroborated departure)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    process.env.SCRAPER_FACULTY_DEPARTURE_DETECTION = 'true';
    probeSourceLink.mockReset();
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    resetOrgUnitCanonicalizerCache();
    for (const name of ['observations', 'research_entities', 'org_units']) {
      await db.collection(name).deleteMany({});
    }
  });

  afterEach(() => {
    delete process.env.SCRAPER_FACULTY_DEPARTURE_DETECTION;
  });

  const seedEntity = (overrides: Record<string, unknown>) =>
    ResearchEntity.create({
      name: 'Fixture Research Entity',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      departments: ['Physics'],
      archived: false,
      websiteUrl: 'https://physics.yale.edu/people/x',
      ...overrides,
    });

  const seedDeptHealth = (runId: string, value: Record<string, unknown>, deptName = 'Physics') =>
    Observation.create({
      entityType: 'departmentRosterHealth',
      entityKey: 'physics',
      field: DEPARTMENT_ROSTER_HEALTH_FIELD,
      value: { deptName, status: 'ok', complete: true, ...value },
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'dept-faculty-roster',
      confidence: 0.9,
      scrapeRunId: new mongoose.Types.ObjectId(runId),
      observedAt: new Date('2026-08-27T00:00:00.000Z'),
    });

  it('suppresses a sustained-absent entity whose links are all dead (both signals)', async () => {
    const run = new mongoose.Types.ObjectId().toString();
    await seedEntity({ slug: 'lab-present' });
    await seedEntity({ slug: 'lab-gone', absentFromRosterSinceRunId: priorRun });
    await seedDeptHealth(run, { discoveredEntityKeys: ['lab-present'], discoveredCount: 1 });
    probeSourceLink.mockResolvedValue(DEAD);

    const result = await reconcileFacultyRosterDeparturesFromRun(run);

    expect(result.suppressed).toBe(1);
    const gone = await readEntity('lab-gone');
    expect(gone?.activeAtYaleCache).toBe(false);
    expect(gone?.yaleStatusCache).toBe('departed');
    expect(gone?.yaleStatusReasonCache).toBe('departed');
    const present = await readEntity('lab-present');
    expect(present?.activeAtYaleCache).not.toBe(false);
  });

  it('holds (does not suppress) a sustained-absent entity whose page is still alive', async () => {
    const run = new mongoose.Types.ObjectId().toString();
    await seedEntity({ slug: 'lab-present' });
    await seedEntity({ slug: 'lab-gone', absentFromRosterSinceRunId: priorRun });
    await seedDeptHealth(run, { discoveredEntityKeys: ['lab-present'], discoveredCount: 1 });
    probeSourceLink.mockResolvedValue(ALIVE);

    const result = await reconcileFacultyRosterDeparturesFromRun(run);

    expect(result.suppressed).toBe(0);
    expect(result.held).toBe(1);
    const gone = await readEntity('lab-gone');
    expect(gone?.activeAtYaleCache).not.toBe(false);
  });

  it('freezes a department whose discovered count collapses below the drop guard', async () => {
    const run = new mongoose.Types.ObjectId().toString();
    await seedEntity({ slug: 'lab-a' });
    await seedEntity({ slug: 'lab-b' });
    await seedEntity({ slug: 'lab-c' });
    await seedEntity({ slug: 'lab-gone', absentFromRosterSinceRunId: priorRun });
    await seedDeptHealth(run, { discoveredEntityKeys: ['lab-a'], discoveredCount: 1 });
    probeSourceLink.mockResolvedValue(DEAD);

    const result = await reconcileFacultyRosterDeparturesFromRun(run);

    expect(result.frozenDepartments).toBe(1);
    expect(result.suppressed).toBe(0);
    const gone = await readEntity('lab-gone');
    expect(gone?.activeAtYaleCache).not.toBe(false);
  });

  it('clears departure when a previously departed entity reappears in the roster', async () => {
    const run = new mongoose.Types.ObjectId().toString();
    await seedEntity({
      slug: 'lab-back',
      yaleStatusCache: 'departed',
      activeAtYaleCache: false,
      yaleStatusReasonCache: 'departed',
      absentFromRosterSinceRunId: priorRun,
    });
    await seedDeptHealth(run, { discoveredEntityKeys: ['lab-back'], discoveredCount: 1 });

    const result = await reconcileFacultyRosterDeparturesFromRun(run);

    expect(result.cleared).toBe(1);
    const back = await readEntity('lab-back');
    expect(back?.activeAtYaleCache).toBe(true);
    expect(back?.yaleStatusCache).toBe('active');
    expect(back?.yaleStatusReasonCache).toBe('');
    expect(back?.absentFromRosterSinceRunId).toBe('');
    expect(probeSourceLink).not.toHaveBeenCalled();
  });

  it('is a no-op when the feature flag is off', async () => {
    delete process.env.SCRAPER_FACULTY_DEPARTURE_DETECTION;
    const run = new mongoose.Types.ObjectId().toString();
    await seedEntity({ slug: 'lab-gone', absentFromRosterSinceRunId: priorRun });
    await seedDeptHealth(run, { discoveredEntityKeys: [], discoveredCount: 0 });

    const result = await reconcileFacultyRosterDeparturesFromRun(run);

    expect(result).toEqual({
      outcome: 'disabled',
      suppressed: 0,
      cleared: 0,
      held: 0,
      frozenDepartments: 0,
      governedDepartments: [],
      unresolvedDepartments: [],
    });
  });

  it('leaves a recorded closure departed when the stale roster still lists it', async () => {
    const run = new mongoose.Types.ObjectId().toString();
    await seedEntity({
      slug: 'lab-closed',
      yaleStatusCache: 'departed',
      activeAtYaleCache: false,
      yaleStatusReasonCache: 'departed',
      studentVisibilitySuppressionReason: 'permanently_closed',
      absentFromRosterSinceRunId: priorRun,
    });
    await seedDeptHealth(run, { discoveredEntityKeys: ['lab-closed'], discoveredCount: 1 });

    const result = await reconcileFacultyRosterDeparturesFromRun(run);

    expect(result.cleared).toBe(0);
    const closed = await readEntity('lab-closed');
    expect(closed?.yaleStatusReasonCache).toBe('departed');
    expect(closed?.activeAtYaleCache).toBe(false);
    expect(closed?.lastSeenInCompleteRosterAt).toBeInstanceOf(Date);
  });

  it('keeps the raw roster name when the OrgUnit catalog is unseeded, so both sides stay raw', async () => {
    const run = new mongoose.Types.ObjectId().toString();
    await seedEntity({ slug: 'lab-present' });
    await seedEntity({ slug: 'lab-gone', absentFromRosterSinceRunId: priorRun });
    await seedDeptHealth(run, { discoveredEntityKeys: ['lab-present'], discoveredCount: 1 });
    probeSourceLink.mockResolvedValue(DEAD);

    const result = await reconcileFacultyRosterDeparturesFromRun(run);

    // With no department rows the canonicalizer suspends fail-closed, so
    // `departments[]` and the snapshot name are both raw and still join.
    expect(result.governedDepartments).toEqual(['Physics']);
    expect(result.unresolvedDepartments).toEqual([]);
    expect(result.suppressed).toBe(1);
  });

  it('reports why it did nothing when the run produced no roster-health snapshot', async () => {
    const run = new mongoose.Types.ObjectId().toString();
    await seedEntity({ slug: 'lab-gone', absentFromRosterSinceRunId: priorRun });

    const result = await reconcileFacultyRosterDeparturesFromRun(run);

    expect(result.outcome).toBe('no-roster-health-observations');
    expect(await readEntity('lab-gone')).toMatchObject({ archived: false });
  });

  it('governs the entities whose canonical department differs from the roster config spelling', async () => {
    const run = new mongoose.Types.ObjectId().toString();
    await OrgUnit.create({
      name: 'English Language and Literature',
      slug: 'english-language-and-literature',
      kind: 'DEPARTMENT',
      aliases: ['English'],
      status: 'ACTIVE',
    });
    resetOrgUnitCanonicalizerCache();
    await seedEntity({ slug: 'lab-present', departments: ['English Language and Literature'] });
    await seedEntity({
      slug: 'lab-gone',
      departments: ['English Language and Literature'],
      absentFromRosterSinceRunId: priorRun,
    });
    // The snapshot records the raw roster-config spelling, which no entity carries.
    await seedDeptHealth(
      run,
      { discoveredEntityKeys: ['lab-present'], discoveredCount: 1 },
      'English',
    );
    probeSourceLink.mockResolvedValue(DEAD);

    const result = await reconcileFacultyRosterDeparturesFromRun(run);

    expect(result.governedDepartments).toEqual(['English Language and Literature']);
    expect(result.unresolvedDepartments).toEqual([]);
    expect(result.suppressed).toBe(1);
    expect(await readEntity('lab-gone')).toMatchObject({ yaleStatusReasonCache: 'departed' });
  });

  it('reports a roster department no OrgUnit names instead of silently governing nothing', async () => {
    const run = new mongoose.Types.ObjectId().toString();
    await OrgUnit.create({
      name: 'Physics',
      slug: 'physics',
      kind: 'DEPARTMENT',
      status: 'ACTIVE',
    });
    resetOrgUnitCanonicalizerCache();
    await seedEntity({ slug: 'lab-gone', absentFromRosterSinceRunId: priorRun });
    await seedDeptHealth(
      run,
      { discoveredEntityKeys: [], discoveredCount: 0 },
      'Ministry of Magic',
    );
    probeSourceLink.mockResolvedValue(DEAD);

    const result = await reconcileFacultyRosterDeparturesFromRun(run);

    expect(result.unresolvedDepartments).toEqual(['Ministry of Magic']);
    expect(result.governedDepartments).toEqual([]);
    expect(result.outcome).toBe('no-authoritative-departments');
    expect(result.suppressed).toBe(0);
    expect(await readEntity('lab-gone')).toMatchObject({ archived: false });
  });

  it('does not suppress through a school-named roster config, which governs no department', async () => {
    const run = new mongoose.Types.ObjectId().toString();
    await OrgUnit.create({
      name: 'Divinity School',
      slug: 'divinity-school',
      kind: 'SCHOOL',
      aliases: ['Divinity'],
      status: 'ACTIVE',
    });
    await OrgUnit.create({
      name: 'Physics',
      slug: 'physics',
      kind: 'DEPARTMENT',
      status: 'ACTIVE',
    });
    resetOrgUnitCanonicalizerCache();
    await seedEntity({ slug: 'lab-gone', absentFromRosterSinceRunId: priorRun });
    await seedDeptHealth(run, { discoveredEntityKeys: [], discoveredCount: 0 }, 'Divinity');
    probeSourceLink.mockResolvedValue(DEAD);

    const result = await reconcileFacultyRosterDeparturesFromRun(run);

    expect(result.unresolvedDepartments).toEqual(['Divinity']);
    expect(result.suppressed).toBe(0);
  });
});
