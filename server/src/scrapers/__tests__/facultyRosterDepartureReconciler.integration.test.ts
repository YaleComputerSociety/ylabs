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
import { ResearchEntity } from '../../models/researchEntity';
import {
  DEPARTMENT_ROSTER_HEALTH_FIELD,
  reconcileFacultyRosterDeparturesFromRun,
} from '../facultyRosterDepartureReconciler';

const priorRun = new mongoose.Types.ObjectId().toString();
const DEAD = { status: 404 };
const ALIVE = { status: 200 };

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
    for (const name of ['observations', 'research_entities']) {
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

  const seedDeptHealth = (
    runId: string,
    value: Record<string, unknown>,
    deptName = 'Physics',
  ) =>
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
    const gone = await ResearchEntity.findOne({ slug: 'lab-gone' }).lean();
    expect(gone?.activeAtYaleCache).toBe(false);
    expect(gone?.yaleStatusCache).toBe('departed');
    expect(gone?.yaleStatusReasonCache).toBe('departed');
    const present = await ResearchEntity.findOne({ slug: 'lab-present' }).lean();
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
    const gone = await ResearchEntity.findOne({ slug: 'lab-gone' }).lean();
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
    const gone = await ResearchEntity.findOne({ slug: 'lab-gone' }).lean();
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
    const back = await ResearchEntity.findOne({ slug: 'lab-back' }).lean();
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

    expect(result).toEqual({ suppressed: 0, cleared: 0, held: 0, frozenDepartments: 0 });
  });
});
