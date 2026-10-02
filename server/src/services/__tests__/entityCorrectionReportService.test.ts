import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createEntityCorrectionReport,
  deriveReporterRole,
  reviewEntityCorrectionReport,
  sanitizeReportNote,
  toReporterCorrectionReport,
} from '../entityCorrectionReportService';
import { ResearchEntity } from '../../models/researchEntity';
import { EntityCorrectionReport } from '../../models/entityCorrectionReport';
import { BadRequestError, NotFoundError } from '../../utils/errors';

vi.mock('../researchGroupService', () => ({
  normalizeResearchDetailSlug: (value: unknown) => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return /^[a-z0-9][a-z0-9_-]{0,159}$/i.test(trimmed) ? trimmed : undefined;
  },
}));

vi.mock('../../models/researchEntity', () => ({
  ResearchEntity: {
    findOne: vi.fn(),
  },
}));

vi.mock('../../models/entityCorrectionReport', () => ({
  EntityCorrectionReport: {
    create: vi.fn(),
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
  },
  EntityCorrectionReportCategory: [
    'wrong_description',
    'wrong_lead',
    'wrong_research_areas',
    'stale_availability',
    'broken_link',
    'not_my_lab',
    'other',
  ],
  EntityCorrectionReportStatus: ['unreviewed', 'accepted', 'dismissed'],
}));

const slug = 'cell-systems-lab';
const entityId = '507f1f77bcf86cd799439011';
const reportId = '507f1f77bcf86cd799439012';

const mockEntityFindOne = (entity: Record<string, unknown> | null) => {
  vi.mocked(ResearchEntity.findOne).mockReturnValue({
    select: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue(entity),
    }),
  } as any);
};

describe('entityCorrectionReportService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(EntityCorrectionReport.findOne).mockReturnValue({
      select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }),
    } as any);
  });

  it('derives reporter role from user type', () => {
    expect(deriveReporterRole('undergraduate')).toBe('student');
    expect(deriveReporterRole('graduate')).toBe('student');
    expect(deriveReporterRole('professor')).toBe('faculty');
    expect(deriveReporterRole('faculty')).toBe('faculty');
    expect(deriveReporterRole('staff')).toBe('staff');
    expect(deriveReporterRole('admin')).toBe('other');
    expect(deriveReporterRole(undefined)).toBe('other');
  });

  it('strips control characters and bounds the note', () => {
    expect(sanitizeReportNote('  bad\u0000value  ')).toBe('bad value');
    expect(sanitizeReportNote('x'.repeat(3000)).length).toBe(2000);
    expect(sanitizeReportNote(42)).toBe('');
  });

  it('projects a report to an allowlist so a field the reporter never needs cannot reach them', () => {
    const createdAt = new Date('2026-09-01T00:00:00.000Z');
    expect(
      toReporterCorrectionReport({
        _id: reportId,
        category: 'other',
        status: 'accepted',
        note: 'note',
        reviewerNote: 'thanks',
        createdAt,
        reviewedBy: 'zzadm01',
        reviewHistory: [{ reviewedBy: 'zzadm01' }],
        reporter: { netId: 'zzrep01' },
        researchEntityId: entityId,
        entitySnapshot: { name: 'x' },
        fieldAddedLater: 'internal',
        __v: 0,
      }),
    ).toEqual({
      _id: reportId,
      category: 'other',
      status: 'accepted',
      note: 'note',
      reviewerNote: 'thanks',
      createdAt,
    });
  });

  it('creates an unreviewed report without mutating the entity', async () => {
    mockEntityFindOne({
      _id: entityId,
      slug,
      name: 'Cell Systems Lab',
      displayName: 'Cell Systems Laboratory',
      kind: 'lab',
      entityType: 'RESEARCH_GROUP',
    });

    vi.mocked(EntityCorrectionReport.create).mockResolvedValue({
      _id: reportId,
      toObject: () => ({ _id: reportId, status: 'unreviewed' }),
    } as any);

    const report = await createEntityCorrectionReport(
      slug,
      { category: 'wrong_description', note: 'The summary describes a different lab.' },
      {
        netId: 'stud1',
        email: 'stud1@example.edu',
        fname: 'Sam',
        lname: 'Student',
        userType: 'undergraduate',
      },
    );

    expect(report).toEqual({ _id: reportId, status: 'unreviewed' });
    expect(EntityCorrectionReport.create).toHaveBeenCalledWith(
      expect.objectContaining({
        researchEntityId: entityId,
        entitySlug: slug,
        category: 'wrong_description',
        note: 'The summary describes a different lab.',
        entitySnapshot: {
          name: 'Cell Systems Laboratory',
          kind: 'lab',
          entityType: 'RESEARCH_GROUP',
        },
        reporter: expect.objectContaining({
          netId: 'stud1',
          userType: 'undergraduate',
          role: 'student',
          name: 'Sam Student',
        }),
      }),
    );
  });

  it('requires an authenticated reporter', async () => {
    await expect(
      createEntityCorrectionReport(slug, { category: 'other' }, { netId: '' }),
    ).rejects.toMatchObject({ status: 401 });
    expect(ResearchEntity.findOne).not.toHaveBeenCalled();
  });

  it('rejects unknown categories with a 400-level error', async () => {
    await expect(
      createEntityCorrectionReport(slug, { category: 'takeover' }, { netId: 'stud1' }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(ResearchEntity.findOne).not.toHaveBeenCalled();
    expect(EntityCorrectionReport.create).not.toHaveBeenCalled();
  });

  it('rejects reports for entities that are not publicly visible', async () => {
    mockEntityFindOne(null);
    await expect(
      createEntityCorrectionReport(
        slug,
        { category: 'broken_link' },
        { netId: 'stud1', userType: 'graduate' },
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(EntityCorrectionReport.create).not.toHaveBeenCalled();
  });

  it('rejects a duplicate open report before creating another record', async () => {
    mockEntityFindOne({ _id: entityId, slug, name: 'Cell Systems Lab' });
    vi.mocked(EntityCorrectionReport.findOne).mockReturnValue({
      select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: reportId }) }),
    } as any);

    await expect(
      createEntityCorrectionReport(
        slug,
        { category: 'not_my_lab', note: 'Not mine.' },
        { netId: 'prof1', userType: 'professor' },
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(EntityCorrectionReport.create).not.toHaveBeenCalled();
  });

  it('reviews a report by recording disposition metadata only', async () => {
    const lean = vi.fn().mockResolvedValue({
      _id: reportId,
      status: 'accepted',
      reviewedBy: 'admin1',
    });
    vi.mocked(EntityCorrectionReport.findOneAndUpdate).mockReturnValue({ lean } as any);

    const report = await reviewEntityCorrectionReport(reportId, 'admin1', {
      status: 'accepted',
      reviewerNote: 'Confirmed against the official page.',
    });

    expect(report).toMatchObject({ _id: reportId, status: 'accepted', reviewedBy: 'admin1' });
    expect(EntityCorrectionReport.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: reportId, status: 'unreviewed' },
      expect.objectContaining({
        status: 'accepted',
        reviewerNote: 'Confirmed against the official page.',
        reviewedBy: 'admin1',
        $push: {
          reviewHistory: expect.objectContaining({
            status: 'accepted',
            reviewedBy: 'admin1',
          }),
        },
      }),
      { returnDocument: 'after', runValidators: true },
    );
  });

  it('rejects invalid review statuses with a 400-level error', async () => {
    await expect(
      reviewEntityCorrectionReport(reportId, 'admin1', { status: 'unreviewed' }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(EntityCorrectionReport.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('surfaces a not-found error when the open report is missing', async () => {
    vi.mocked(EntityCorrectionReport.findOneAndUpdate).mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    } as any);

    await expect(
      reviewEntityCorrectionReport(reportId, 'admin1', { status: 'dismissed' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
