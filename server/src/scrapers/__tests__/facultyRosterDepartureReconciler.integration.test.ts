import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchPage = vi.fn();
vi.mock('../utils/httpFetch', async () => {
  const actual = await vi.importActual<typeof import('../utils/httpFetch')>('../utils/httpFetch');
  return { ...actual, fetchPageWithPolicy: (url: string) => fetchPage(url) };
});

import { Observation } from '../../models/observation';
import { OrgUnit } from '../../models/orgUnit';
import { Researcher } from '../../models/researcher';
import { ResearchEntity } from '../../models/researchEntity';
import { RoleAssignment } from '../../models/roleAssignment';
import { resetOrgUnitCanonicalizerCache } from '../orgUnitCanonicalization';
import {
  DEPARTMENT_ROSTER_HEALTH_FIELD,
  reconcileFacultyRosterDeparturesFromRun,
} from '../facultyRosterDepartureReconciler';

const priorRun = new mongoose.Types.ObjectId().toString();
const TOMBSTONE = {
  status: 200,
  url: 'https://physics.yale.edu/people/x',
  html: '<h1>Somebody</h1><p>No people to display.</p>',
};
const LIVE_PROFILE = {
  status: 200,
  url: 'https://physics.yale.edu/people/x',
  html: '<h1>Somebody</h1><p>Associate Professor of Physics</p>',
};

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
    fetchPage.mockReset();
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    resetOrgUnitCanonicalizerCache();
    for (const name of [
      'observations',
      'research_entities',
      'org_units',
      'researchers',
      'role_assignments',
    ]) {
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

  // A snapshot governs departures only when its run recorded reading the page, so
  // every fixture that expects the lane to act has to say it read one (#3251).
  const FETCHED_READ = {
    pagesRead: 1,
    readMode: 'html',
    cacheAllowed: false,
    readAt: '2026-08-27T00:00:00.000Z',
  };

  const seedDeptHealth = (runId: string, value: Record<string, unknown>, deptName = 'Physics') =>
    Observation.create({
      entityType: 'departmentRosterHealth',
      entityKey: 'physics',
      field: DEPARTMENT_ROSTER_HEALTH_FIELD,
      value: {
        deptName,
        status: 'ok',
        complete: true,
        read: FETCHED_READ,
        ...value,
      },
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'dept-faculty-roster',
      confidence: 0.9,
      scrapeRunId: new mongoose.Types.ObjectId(runId),
      observedAt: new Date('2026-08-27T00:00:00.000Z'),
    });

  it('suppresses a sustained-absent entity whose Yale profile asserts absence (both signals)', async () => {
    const run = new mongoose.Types.ObjectId().toString();
    await seedEntity({ slug: 'lab-present' });
    await seedEntity({ slug: 'lab-gone', absentFromRosterSinceRunId: priorRun });
    await seedDeptHealth(run, { discoveredEntityKeys: ['lab-present'], discoveredCount: 1 });
    fetchPage.mockResolvedValue(TOMBSTONE);

    const result = await reconcileFacultyRosterDeparturesFromRun(run);

    expect(result.suppressed).toBe(1);
    const gone = await readEntity('lab-gone');
    expect(gone?.activeAtYaleCache).toBe(false);
    expect(gone?.yaleStatusCache).toBe('departed');
    expect(gone?.yaleStatusReasonCache).toBe('departed');
    const present = await readEntity('lab-present');
    expect(present?.activeAtYaleCache).not.toBe(false);
  });

  // Writing the Yale-status fields is not the same as removing the row from the
  // directory: `studentVisibilityTier` is stored, and `activeAtYaleCache === false`
  // only decides the tier the NEXT gate pass computes. Without the re-gate the
  // first enabled run on Development left a row written `departed` still serving
  // `student_ready` at HTTP 200.
  it('re-gates the stored visibility tier, so a suppression actually leaves the served surface', async () => {
    const run = new mongoose.Types.ObjectId().toString();
    await seedEntity({
      slug: 'lab-present',
      studentVisibilityTier: 'student_ready',
      studentVisibilityComputedTier: 'student_ready',
    });
    await seedEntity({
      slug: 'lab-gone',
      absentFromRosterSinceRunId: priorRun,
      studentVisibilityTier: 'student_ready',
      studentVisibilityComputedTier: 'student_ready',
    });
    await seedDeptHealth(run, { discoveredEntityKeys: ['lab-present'], discoveredCount: 1 });
    fetchPage.mockResolvedValue(TOMBSTONE);

    const result = await reconcileFacultyRosterDeparturesFromRun(run);

    expect(result.regatedEntities).toBe(1);
    const gone = await readEntity('lab-gone');
    expect(gone?.studentVisibilityTier).toBe('suppressed');
    expect(gone?.studentVisibilityReasons).toContain('inactive_at_yale');
    // A `refresh_present` row is not re-gated, and this thin fixture would compute
    // `operator_review` if it were, so the stored tier surviving proves the scoping.
    expect(await readEntity('lab-present')).toMatchObject({
      studentVisibilityTier: 'student_ready',
    });
  });

  it('holds (does not suppress) a sustained-absent entity whose Yale profile still names a person', async () => {
    const run = new mongoose.Types.ObjectId().toString();
    await seedEntity({ slug: 'lab-present' });
    await seedEntity({ slug: 'lab-gone', absentFromRosterSinceRunId: priorRun });
    await seedDeptHealth(run, { discoveredEntityKeys: ['lab-present'], discoveredCount: 1 });
    fetchPage.mockResolvedValue(LIVE_PROFILE);

    const result = await reconcileFacultyRosterDeparturesFromRun(run);

    expect(result.suppressed).toBe(0);
    expect(result.held).toBe(1);
    const gone = await readEntity('lab-gone');
    expect(gone?.activeAtYaleCache).not.toBe(false);
  });

  // The shape of a real relocation: the entity's only citation is the professor's
  // own website, which moves with them and answers 200 from the new institution, so
  // reading the entity alone finds no Yale page to judge. The Yale profile lives on
  // the lead's `Researcher` row.
  it('resolves the Yale profile through the lead role edge when the entity cites only a personal site', async () => {
    const run = new mongoose.Types.ObjectId().toString();
    await seedEntity({ slug: 'lab-present' });
    const gone = await seedEntity({
      slug: 'lab-relocated',
      websiteUrl: 'https://somebody.example.com/',
      sourceUrls: ['https://somebody.example.com/'],
      absentFromRosterSinceRunId: priorRun,
    });
    const lead = await Researcher.create({
      displayName: 'Somebody',
      profileLinks: [
        {
          kind: 'YALE_OFFICIAL',
          purpose: 'PRIMARY_IDENTITY',
          url: 'https://politicalscience.yale.edu/people/somebody',
          verifiedAt: new Date('2026-08-31T00:00:00.000Z'),
          healthStatus: 'HEALTHY',
        },
      ],
    });
    await RoleAssignment.create({
      personId: lead._id,
      target: { kind: 'RESEARCH_ENTITY', id: gone._id },
      role: 'PI',
      confidence: 0.7,
      archived: false,
    });
    await seedDeptHealth(run, { discoveredEntityKeys: ['lab-present'], discoveredCount: 1 });
    fetchPage.mockResolvedValue(TOMBSTONE);

    const result = await reconcileFacultyRosterDeparturesFromRun(run);

    expect(fetchPage).toHaveBeenCalledWith('https://politicalscience.yale.edu/people/somebody');
    expect(result.suppressed).toBe(1);
    expect(await readEntity('lab-relocated')).toMatchObject({
      activeAtYaleCache: false,
      yaleStatusReasonCache: 'departed',
    });
  });

  it('holds an absent entity with no Yale profile anywhere, rather than inferring absence', async () => {
    const run = new mongoose.Types.ObjectId().toString();
    await seedEntity({ slug: 'lab-present' });
    await seedEntity({
      slug: 'lab-no-yale-page',
      websiteUrl: 'https://somebody.example.com/',
      sourceUrls: ['https://somebody.example.com/'],
      absentFromRosterSinceRunId: priorRun,
    });
    await seedDeptHealth(run, { discoveredEntityKeys: ['lab-present'], discoveredCount: 1 });

    const result = await reconcileFacultyRosterDeparturesFromRun(run);

    expect(fetchPage).not.toHaveBeenCalled();
    expect(result.suppressed).toBe(0);
    expect(result.held).toBe(1);
  });

  it('freezes a department whose discovered count collapses below the drop guard', async () => {
    const run = new mongoose.Types.ObjectId().toString();
    await seedEntity({ slug: 'lab-a' });
    await seedEntity({ slug: 'lab-b' });
    await seedEntity({ slug: 'lab-c' });
    await seedEntity({ slug: 'lab-gone', absentFromRosterSinceRunId: priorRun });
    await seedDeptHealth(run, { discoveredEntityKeys: ['lab-a'], discoveredCount: 1 });
    fetchPage.mockResolvedValue(TOMBSTONE);

    const result = await reconcileFacultyRosterDeparturesFromRun(run);

    expect(result.frozenDepartments).toBe(1);
    expect(result.suppressed).toBe(0);
    const gone = await readEntity('lab-gone');
    expect(gone?.activeAtYaleCache).not.toBe(false);
  });

  it('refuses to suppress on a snapshot whose run recorded no read of the page', async () => {
    const run = new mongoose.Types.ObjectId().toString();
    await seedEntity({ slug: 'lab-present' });
    await seedEntity({ slug: 'lab-gone', absentFromRosterSinceRunId: priorRun });
    await seedDeptHealth(run, {
      discoveredEntityKeys: ['lab-present'],
      discoveredCount: 1,
      read: undefined,
    });
    fetchPage.mockResolvedValue(TOMBSTONE);

    const result = await reconcileFacultyRosterDeparturesFromRun(run);

    expect(result.outcome).toBe('no-authoritative-departments');
    expect(result.suppressed).toBe(0);
    expect(result.readProvenance).toEqual({
      fetched: 0,
      'cache-permitted': 0,
      'not-read': 0,
      unrecorded: 1,
    });
    const gone = await readEntity('lab-gone');
    expect(gone?.activeAtYaleCache).not.toBe(false);
  });

  it('refuses to suppress when the snapshot records that no page was read', async () => {
    const run = new mongoose.Types.ObjectId().toString();
    await seedEntity({ slug: 'lab-present' });
    await seedEntity({ slug: 'lab-gone', absentFromRosterSinceRunId: priorRun });
    await seedDeptHealth(run, {
      discoveredEntityKeys: ['lab-present'],
      discoveredCount: 1,
      read: { pagesRead: 0, readMode: 'none', cacheAllowed: false, readAt: null },
    });
    fetchPage.mockResolvedValue(TOMBSTONE);

    const result = await reconcileFacultyRosterDeparturesFromRun(run);

    expect(result.suppressed).toBe(0);
    expect(result.readProvenance['not-read']).toBe(1);
  });

  it('dates a row from its own department rather than the last snapshot read', async () => {
    const run = new mongoose.Types.ObjectId().toString();
    const physicsReadAt = '2026-09-24T01:00:00.000Z';
    const astronomyReadAt = '2026-09-24T09:00:00.000Z';
    await seedEntity({ slug: 'lab-physics', departments: ['Physics'] });
    await seedDeptHealth(run, {
      discoveredEntityKeys: ['lab-physics'],
      discoveredCount: 1,
      read: { pagesRead: 1, readMode: 'html', cacheAllowed: false, readAt: physicsReadAt },
    });
    await seedDeptHealth(
      run,
      {
        discoveredEntityKeys: [],
        discoveredCount: 0,
        read: { pagesRead: 1, readMode: 'html', cacheAllowed: false, readAt: astronomyReadAt },
      },
      'Astronomy',
    );

    await reconcileFacultyRosterDeparturesFromRun(run);

    const physics = await readEntity('lab-physics');
    expect(physics?.lastSeenInCompleteRosterAt?.toISOString()).toBe(physicsReadAt);
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
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('is a no-op when the feature flag is off', async () => {
    delete process.env.SCRAPER_FACULTY_DEPARTURE_DETECTION;
    const run = new mongoose.Types.ObjectId().toString();
    await seedEntity({ slug: 'lab-gone', absentFromRosterSinceRunId: priorRun });
    await seedDeptHealth(run, { discoveredEntityKeys: [], discoveredCount: 0 });

    const result = await reconcileFacultyRosterDeparturesFromRun(run);

    expect(result).toEqual({
      outcome: 'disabled',
      mode: 'apply',
      suppressed: 0,
      cleared: 0,
      held: 0,
      frozenDepartments: 0,
      regatedEntities: 0,
      planned: {
        refresh_present: 0,
        record_first_absence: 0,
        suppress_departed: 0,
        clear_departed: 0,
      },
      // A disabled pass decides nothing, so it explains nothing and has read no
      // evidence. Asserted rather than omitted, because this is a whole-object
      // comparison and the point of it is that a new result field cannot appear
      // populated on a pass that never ran (#3235).
      plannedRows: [],
      evidenceFreshness: {
        snapshotsRead: 0,
        distinctSnapshotObservedAt: 0,
        planningRunFetchesSucceeded: 0,
      },
      governedDepartments: [],
      unresolvedDepartments: [],
      readProvenance: { fetched: 0, 'cache-permitted': 0, 'not-read': 0, unrecorded: 0 },
    });
    const gone = await readEntity('lab-gone');
    expect(gone?.lastSeenInCompleteRosterAt).toBeUndefined();
  });

  // A dry run used to return `outcome: 'dry-run'` before reading anything, so the
  // only way to learn what the lane would do was to let it do it. The invariant
  // that a dry run writes nothing is unchanged; what moved is that it now reports.
  it('plans without the flag and without writing, so the lane is readable while off', async () => {
    delete process.env.SCRAPER_FACULTY_DEPARTURE_DETECTION;
    const run = new mongoose.Types.ObjectId().toString();
    await seedEntity({ slug: 'lab-present' });
    await seedEntity({ slug: 'lab-gone', absentFromRosterSinceRunId: priorRun });
    await seedDeptHealth(run, { discoveredEntityKeys: ['lab-present'], discoveredCount: 1 });
    fetchPage.mockResolvedValue(TOMBSTONE);

    const result = await reconcileFacultyRosterDeparturesFromRun(run, { dryRun: true });

    expect(result.outcome).toBe('planned');
    expect(result.mode).toBe('plan');
    expect(result.planned).toEqual({
      refresh_present: 1,
      record_first_absence: 0,
      suppress_departed: 1,
      clear_departed: 0,
    });
    expect(result.governedDepartments).toEqual(['Physics']);
    // Written counters stay at zero, and so does the corpus.
    expect(result.suppressed).toBe(0);
    expect(result.held).toBe(0);
    const gone = await readEntity('lab-gone');
    expect(gone?.activeAtYaleCache).not.toBe(false);
    expect(gone?.yaleStatusReasonCache).toBeFalsy();
    const present = await readEntity('lab-present');
    expect(present?.lastSeenInCompleteRosterAt).toBeUndefined();
    // A plan does not fetch: the probe only ever withholds a suppression, so the
    // planned figure is an upper bound rather than a prediction.
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('counts the same planned actions it would write when the flag is on', async () => {
    const run = new mongoose.Types.ObjectId().toString();
    await seedEntity({ slug: 'lab-present' });
    await seedEntity({ slug: 'lab-newly-absent' });
    await seedDeptHealth(run, { discoveredEntityKeys: ['lab-present'], discoveredCount: 1 });
    fetchPage.mockResolvedValue(TOMBSTONE);

    const planned = await reconcileFacultyRosterDeparturesFromRun(run, { dryRun: true });
    const applied = await reconcileFacultyRosterDeparturesFromRun(run);

    expect(planned.planned).toEqual(applied.planned);
    expect(applied.planned).toMatchObject({ refresh_present: 1, record_first_absence: 1 });
    const absent = await readEntity('lab-newly-absent');
    expect(absent?.absentFromRosterSinceRunId).toBe(run);
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
    fetchPage.mockResolvedValue(TOMBSTONE);

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
    fetchPage.mockResolvedValue(TOMBSTONE);

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
    fetchPage.mockResolvedValue(TOMBSTONE);

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
    fetchPage.mockResolvedValue(TOMBSTONE);

    const result = await reconcileFacultyRosterDeparturesFromRun(run);

    expect(result.unresolvedDepartments).toEqual(['Divinity']);
    expect(result.suppressed).toBe(0);
  });
});
