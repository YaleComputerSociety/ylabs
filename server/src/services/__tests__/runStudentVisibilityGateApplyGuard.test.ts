import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  bulkWrite: vi.fn(),
  aggregate: vi.fn(),
  distinct: vi.fn(),
  signalFind: vi.fn(),
  roster: vi.fn(),
  queueBulkWrite: vi.fn(),
  queueFind: vi.fn(),
  resolveArchived: vi.fn(),
}));

vi.mock('../../models/researchEntity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../models/researchEntity')>()),
  ResearchEntity: {
    find: mocks.find,
    bulkWrite: mocks.bulkWrite,
  },
}));

vi.mock('../../models/signal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../models/signal')>()),
  Signal: {
    aggregate: mocks.aggregate,
    distinct: mocks.distinct,
    find: mocks.signalFind,
  },
}));

vi.mock('../../models/visibilityReleaseQueueItem', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../models/visibilityReleaseQueueItem')>()),
  VisibilityReleaseQueueItem: {
    bulkWrite: mocks.queueBulkWrite,
    find: mocks.queueFind,
    updateMany: mocks.resolveArchived,
  },
}));

vi.mock('../researchEntityMembershipAccessor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../researchEntityMembershipAccessor')>()),
  getResearchEntityRosterByEntityId: mocks.roster,
}));

import { runStudentVisibilityGate } from '../studentVisibilityGateService';

const leadlessLabEntities = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    _id: `lab-${index}`,
    name: `Lab ${index}`,
    slug: `lab-${index}`,
    entityType: 'LAB',
    kind: 'lab',
  }));

const stubResearchEntityFind = (entities: unknown[]) => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(entities),
  };
  mocks.find.mockReturnValue(chain);
};

describe('runStudentVisibilityGate apply guard', () => {
  beforeEach(() => {
    mocks.aggregate.mockResolvedValue([]);
    mocks.distinct.mockResolvedValue([]);
    mocks.signalFind.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([]),
    });
    mocks.roster.mockResolvedValue(new Map());
    mocks.bulkWrite.mockResolvedValue(undefined);
    mocks.queueBulkWrite.mockResolvedValue(undefined);
    mocks.queueFind.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([]),
    });
    mocks.resolveArchived.mockResolvedValue({ modifiedCount: 0 });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('refuses to apply and writes nothing when the canonical roster resolves zero leads', async () => {
    stubResearchEntityFind(leadlessLabEntities(30));

    await expect(
      runStudentVisibilityGate({ collection: 'research', mode: 'apply' }),
    ).rejects.toThrow(/Refusing to apply student visibility gate/);

    expect(mocks.bulkWrite).not.toHaveBeenCalled();
    expect(mocks.queueBulkWrite).not.toHaveBeenCalled();
  });

  it('still applies for a scoped roster too small to enforce the empty-roster guard', async () => {
    stubResearchEntityFind(leadlessLabEntities(5));

    const report = await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });

    expect(report.mode).toBe('apply');
    expect(mocks.bulkWrite).toHaveBeenCalledTimes(1);
  });

  it('keeps duplicate_risk on a scoped recompute whose same-PI twin is outside the requested set (#1911)', async () => {
    const scopedShell = {
      _id: 'som-barrios',
      name: 'John Manuel Barrios',
      slug: 'dept-som-john-manuel-barrios',
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'faculty_research_area',
      websiteUrl: 'https://som.yale.edu/faculty-research/faculty-directory/john-manuel-barrios',
      fullDescription: '',
      shortDescription: '',
      sourceUrls: [],
      departments: ['Economics'],
      researchAreas: [],
    };
    const concreteTwin = {
      _id: 'econ-barrios',
      name: 'John Manuel Barrios',
      slug: 'dept-econ-john-manuel-barrios',
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'faculty_research_area',
      websiteUrl: 'https://johnmbarrios.com',
      fullDescription:
        'John Manuel Barrios studies corporate finance, entrepreneurship, and the real effects of financial reporting, drawing on large administrative datasets to trace how firms respond to regulation.',
      shortDescription: 'Corporate finance and entrepreneurship research.',
      sourceUrls: ['https://johnmbarrios.com'],
      departments: ['Economics'],
      researchAreas: ['Corporate finance'],
    };

    const chainFor = (rows: unknown[]) => ({
      select: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue(rows),
    });
    mocks.find.mockImplementation((filter: any) => {
      if (filter?.name?.$in) return chainFor([]);
      if (filter?.archived && filter?._id?.$in) return chainFor([scopedShell]);
      if (filter?.archived) return chainFor([scopedShell, concreteTwin]);
      return chainFor([]);
    });

    const leadFor = (researchEntityId: string) => ({
      researchEntityId,
      personId: 'pi-barrios',
      role: 'pi',
      state: 'ACTIVE',
      name: 'John Manuel Barrios',
      netid: 'jmb-fixture',
    });
    mocks.roster.mockImplementation((ids: unknown[]) => {
      const idSet = new Set(ids.map(String));
      const byEntity = new Map<string, unknown[]>();
      byEntity.set('som-barrios', [leadFor('som-barrios')]);
      if (idSet.has('econ-barrios')) byEntity.set('econ-barrios', [leadFor('econ-barrios')]);
      return Promise.resolve(byEntity);
    });

    await runStudentVisibilityGate({
      collection: 'research',
      mode: 'apply',
      recordIds: ['som-barrios'],
    });

    expect(mocks.roster).toHaveBeenCalledWith(
      expect.arrayContaining(['som-barrios', 'econ-barrios']),
    );
    const researchOps = mocks.bulkWrite.mock.calls[0]?.[0] || [];
    const scopedOp = researchOps.find((op: any) => op?.updateOne?.filter?._id === 'som-barrios');
    expect(scopedOp).toBeDefined();
    expect(scopedOp.updateOne.update.$set.studentVisibilityReasons).toContain('duplicate_risk');
    expect(scopedOp.updateOne.update.$set.studentVisibilityTier).not.toBe('student_ready');
  });
});
