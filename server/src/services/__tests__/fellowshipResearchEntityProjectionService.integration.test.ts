import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const syncEntityMock = vi.fn(async (_entityType: string, _doc: Record<string, unknown>) => {});
const syncEntitiesMock = vi.fn(async (_entityType: string, _docs: Record<string, unknown>[]) => {});

vi.mock('../meiliSyncService', () => ({
  syncEntity: (entityType: string, doc: Record<string, unknown>) => syncEntityMock(entityType, doc),
  syncEntities: (entityType: string, docs: Record<string, unknown>[]) =>
    syncEntitiesMock(entityType, docs),
}));

import { Fellowship } from '../../models/fellowship';
import { ResearchEntity } from '../../models/researchEntity';
import { Signal } from '../../models/signal';
import { publicStudentVisibilityTiers } from '../../models/studentVisibility';
import {
  projectAllStudentReadyFellowships,
  projectFellowshipToResearchEntity,
} from '../fellowshipResearchEntityProjectionService';

const raProgram = {
  sourceKey: 'stars-summer-research-program',
  title: 'STARS Summer Research Program',
  summary: 'A structured summer research program placing undergraduates in Yale labs.',
  description:
    'The STARS Summer Research Program supports undergraduate researchers with mentored laboratory research and a stipend.',
  studentFacingCategory: 'Structured summer program',
  programKind: 'STRUCTURED_PROGRAM',
  programCategory: 'SUMMER_RESEARCH_PROGRAM',
  entryMode: 'SECURE_MENTOR_THEN_APPLY',
  purpose: ['Research'],
  sourceUrl: 'https://onhsa.yale.edu/programs/stars',
  sourceName: 'yale-college-fellowships-office',
  studentVisibilityTier: 'student_ready',
  archived: false,
};

const fundingProgram = {
  sourceKey: 'richter-summer-fellowship',
  title: 'Richter Summer Research Fellowship',
  summary: 'Summer research funding for independent undergraduate research projects.',
  description: 'Funds independent undergraduate summer research and senior thesis projects.',
  programKind: 'FELLOWSHIP_FUNDING',
  programCategory: 'FELLOWSHIP',
  entryMode: 'SECURE_MENTOR_THEN_APPLY',
  purpose: ['Research', 'Senior Research Project or Senior Essay'],
  sourceUrl: 'https://funding.yale.edu/richter',
  applicationLink: 'https://apply.yale.edu/richter',
  sourceName: 'yale-college-fellowships-office',
  studentVisibilityTier: 'student_ready',
  archived: false,
};

const nonResearchProgram = {
  sourceKey: 'yale-journalism-award',
  title: 'Yale Journalism Award',
  summary: 'Recognizes excellence in student journalism.',
  description: 'An award for outstanding journalism, not research.',
  programKind: 'OTHER',
  programCategory: 'FELLOWSHIP',
  purpose: ['Journalism'],
  sourceUrl: 'https://example.edu/journalism-award',
  studentVisibilityTier: 'student_ready',
  archived: false,
};

const notReadyProgram = {
  sourceKey: 'draft-research-program',
  title: 'Draft Research Program',
  summary: 'A mentored research program still under review.',
  description: 'A mentored undergraduate research program pending operator review.',
  programKind: 'RA_PROGRAM',
  programCategory: 'RECURRING_PROGRAM',
  purpose: ['Research'],
  sourceUrl: 'https://example.edu/draft-program',
  studentVisibilityTier: 'operator_review',
  archived: false,
};

describe('fellowship research-entity projection service (issue #1381)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (replSet) await replSet.stop();
  });

  beforeEach(async () => {
    syncEntityMock.mockClear();
    syncEntitiesMock.mockClear();
    await Fellowship.deleteMany({});
    await ResearchEntity.deleteMany({});
    await Signal.deleteMany({});
  });

  afterEach(async () => {
    await Fellowship.deleteMany({});
    await ResearchEntity.deleteMany({});
    await Signal.deleteMany({});
  });

  const servablePrograms = () =>
    ResearchEntity.find({
      archived: { $ne: true },
      studentVisibilityTier: { $in: publicStudentVisibilityTiers },
      entityType: { $in: ['RA_PROGRAM', 'FELLOWSHIP_PROGRAM'] },
    }).lean();

  it('projects student_ready programs into the servable /research corpus with correct types', async () => {
    await Fellowship.create([raProgram, fundingProgram, nonResearchProgram, notReadyProgram]);

    const report = await projectAllStudentReadyFellowships({ apply: true });

    expect(report.mode).toBe('apply');
    expect(report.created).toBe(2);
    expect(report.byEntityType).toMatchObject({ RA_PROGRAM: 1, FELLOWSHIP_PROGRAM: 1 });
    expect(report.skippedByReason['not-research-related']).toBe(1);

    const servable = await servablePrograms();
    const bySlug = new Map(servable.map((e: any) => [e.slug, e]));
    expect(bySlug.get('program-stars-summer-research-program')?.entityType).toBe('RA_PROGRAM');
    expect(bySlug.get('program-richter-summer-fellowship')?.entityType).toBe('FELLOWSHIP_PROGRAM');
    expect(servable.every((e: any) => e.kind === 'program')).toBe(true);

    const starsEntity: any = bySlug.get('program-stars-summer-research-program');
    const signals = await Signal.find({ researchEntityId: starsEntity._id }).lean();
    expect(signals.map((s: any) => s.type)).toContain('APPLICATION_ONLY');
  });

  it('is idempotent: re-running updates rather than duplicating', async () => {
    await Fellowship.create([raProgram, fundingProgram]);
    await projectAllStudentReadyFellowships({ apply: true });
    const secondRun = await projectAllStudentReadyFellowships({ apply: true });

    expect(secondRun.created).toBe(0);
    expect(secondRun.updated).toBe(2);
    expect(await ResearchEntity.countDocuments({ slug: /^program-/ })).toBe(2);
  });

  it('suppresses a projected program whose fellowship is no longer student_ready', async () => {
    await Fellowship.create([raProgram]);
    await projectAllStudentReadyFellowships({ apply: true });
    expect((await servablePrograms()).length).toBe(1);

    await Fellowship.updateOne(
      { sourceKey: raProgram.sourceKey },
      { $set: { studentVisibilityTier: 'operator_review' } },
    );
    const report = await projectAllStudentReadyFellowships({ apply: true });

    expect(report.suppressedStale).toBe(1);
    expect((await servablePrograms()).length).toBe(0);
    const suppressed: any = await ResearchEntity.findOne({
      slug: 'program-stars-summer-research-program',
    }).lean();
    expect(suppressed?.studentVisibilityTier).toBe('suppressed');
  });

  it('does not write in dry-run mode', async () => {
    await Fellowship.create([raProgram]);
    const report = await projectAllStudentReadyFellowships({ apply: false });

    expect(report.mode).toBe('dry-run');
    expect(report.created).toBe(1);
    expect(await ResearchEntity.countDocuments({})).toBe(0);
  });

  it('suppresses an existing projected home when a single fellowship stops qualifying', async () => {
    await ResearchEntity.create([
      {
        slug: 'program-stars-summer-research-program',
        name: 'STARS Summer Research Program',
        kind: 'program',
        entityType: 'RA_PROGRAM',
        studentVisibilityTier: 'student_ready',
        archived: false,
      },
    ]);

    const result = await projectFellowshipToResearchEntity(
      { ...raProgram, studentVisibilityTier: 'operator_review' },
      { sync: false },
    );

    expect(result.suppressed).toBe(true);
    const entity: any = await ResearchEntity.findOne({
      slug: 'program-stars-summer-research-program',
    }).lean();
    expect(entity?.studentVisibilityTier).toBe('suppressed');
  });
});
