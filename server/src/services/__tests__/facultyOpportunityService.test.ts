import { describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import {
  archiveFacultyOpportunity,
  closeFacultyOpportunity,
  createFacultyOpportunityDraft,
  FacultyOpportunityError,
  submitFacultyOpportunity,
  validateFacultyOpportunityInput,
} from '../facultyOpportunityService';

const ids = {
  user: new mongoose.Types.ObjectId('64f111111111111111111111'),
  faculty: new mongoose.Types.ObjectId('64f222222222222222222222'),
  entity: new mongoose.Types.ObjectId('64f333333333333333333333'),
  membership: new mongoose.Types.ObjectId('64f444444444444444444444'),
  opportunity: new mongoose.Types.ObjectId('64f555555555555555555555'),
  pathway: new mongoose.Types.ObjectId('64f666666666666666666666'),
};

const chain = (value: unknown) => {
  const query: any = {
    select: vi.fn(() => query),
    sort: vi.fn(() => query),
    limit: vi.fn(() => query),
    lean: vi.fn(async () => value),
  };
  return query;
};

const facultyUser = {
  _id: ids.user,
  netid: 'faculty1',
  userType: 'faculty',
  userConfirmed: true,
  profileVerified: true,
  facultyMemberId: ids.faculty,
};

const entity = {
  _id: ids.entity,
  slug: 'verified-lab',
  name: 'Verified Lab',
  entityType: 'LAB',
  studentVisibilityReasons: [],
};

const membership = {
  _id: ids.membership,
  researchEntityId: ids.entity,
  userId: ids.user,
  facultyMemberId: ids.faculty,
  role: 'pi',
};

const completeInput = {
  researchEntityId: ids.entity.toHexString(),
  title: 'Undergraduate imaging research assistant',
  description:
    'Support an active imaging study by preparing datasets, documenting analyses, and joining a weekly research meeting.',
  term: 'Fall 2026',
  deadline: '2026-09-01T23:59:59.000Z',
  applicationUrl: 'https://research.yale.edu/forms/apply-imaging-role',
  status: 'OPEN',
  hoursPerWeek: 8,
  compensationType: 'PAID',
  payRate: '$18 per hour',
  eligibility: 'Open to Yale undergraduates with introductory Python experience.',
};

const baseDeps = (overrides: Record<string, unknown> = {}) => ({
  userModel: { findOne: vi.fn(() => chain(facultyUser)) },
  researchEntityModel: { findOne: vi.fn(() => chain(entity)) },
  memberModel: { find: vi.fn(() => chain([membership])) },
  transaction: async (work: (session: any) => Promise<unknown>) => work({ id: 'session' }),
  now: () => new Date('2026-07-14T12:00:00.000Z'),
  ...overrides,
});

describe('facultyOpportunityService validation and authorization', () => {
  it('fails closed for unsafe URLs, inconsistent rolling dates, and out-of-range hours', () => {
    expect(() =>
      validateFacultyOpportunityInput(
        {
          ...completeInput,
          status: 'ROLLING',
          applicationUrl: 'http://localhost:3000/apply',
          hoursPerWeek: 120,
        },
        { requireComplete: true, now: new Date('2026-07-14T12:00:00.000Z') },
      ),
    ).toThrow(FacultyOpportunityError);

    try {
      validateFacultyOpportunityInput(
        {
          ...completeInput,
          status: 'ROLLING',
          applicationUrl: 'http://localhost:3000/apply',
          hoursPerWeek: 120,
        },
        { requireComplete: true, now: new Date('2026-07-14T12:00:00.000Z') },
      );
    } catch (error) {
      expect((error as FacultyOpportunityError).fieldErrors).toMatchObject({
        deadline: 'Remove the deadline or choose a dated opening',
        applicationUrl: 'Enter a safe public HTTPS application URL',
        hoursPerWeek: 'Enter a whole number from 1 to 80',
      });
    }
  });

  it('rejects expired submissions while allowing an incomplete bounded draft', () => {
    expect(
      validateFacultyOpportunityInput({
        ...completeInput,
        description: '',
        applicationUrl: '',
        deadline: '',
      }),
    ).toMatchObject({ title: completeInput.title, description: '', applicationUrl: '' });

    expect(() =>
      validateFacultyOpportunityInput(
        { ...completeInput, deadline: '2026-06-01T00:00:00.000Z' },
        { requireComplete: true, now: new Date('2026-07-14T12:00:00.000Z') },
      ),
    ).toThrow(/highlighted opportunity fields/);
  });

  it.each([
    ['2026-07-14', '2026-07-15T03:59:59.999Z'],
    ['2026-01-14', '2026-01-15T04:59:59.999Z'],
    ['2026-03-08', '2026-03-09T03:59:59.999Z'],
    ['2026-11-01', '2026-11-02T04:59:59.999Z'],
  ])('keeps %s valid through the selected Yale calendar day', (input, expected) => {
    expect(
      validateFacultyOpportunityInput(
        { ...completeInput, deadline: input },
        { requireComplete: true, now: new Date(`${input}T12:00:00.000Z`) },
      ).deadline,
    ).toEqual(new Date(expected));
  });

  it.each(['2026-02-29', '2026-02-31', '2026-04-31', '2026-13-01', '2026-00-10'])(
    'rejects impossible calendar deadline %s',
    (deadline) => {
      expect(() =>
        validateFacultyOpportunityInput(
          { ...completeInput, deadline },
          { requireComplete: true, now: new Date('2026-01-01T12:00:00.000Z') },
        ),
      ).toThrow(FacultyOpportunityError);

      try {
        validateFacultyOpportunityInput(
          { ...completeInput, deadline },
          { requireComplete: true, now: new Date('2026-01-01T12:00:00.000Z') },
        );
      } catch (error) {
        expect((error as FacultyOpportunityError).fieldErrors).toMatchObject({
          deadline: 'Enter a valid deadline',
        });
      }
    },
  );

  it('denies an authoritative unverified faculty account even if the session middleware was stale', async () => {
    const deps = baseDeps({
      userModel: {
        findOne: vi.fn(() => chain({ ...facultyUser, profileVerified: false })),
      },
    });

    await expect(
      createFacultyOpportunityDraft(
        'faculty1',
        completeInput,
        'faculty-opportunity-key-1',
        deps as any,
      ),
    ).rejects.toMatchObject({ code: 'PROFILE_VERIFICATION_REQUIRED', status: 403 });
  });

  it('denies conflicting canonical faculty membership identity', async () => {
    const deps = baseDeps({
      memberModel: {
        find: vi.fn(() =>
          chain([{ ...membership, facultyMemberId: new mongoose.Types.ObjectId() }]),
        ),
      },
    });

    await expect(
      createFacultyOpportunityDraft(
        'faculty1',
        completeInput,
        'faculty-opportunity-key-2',
        deps as any,
      ),
    ).rejects.toMatchObject({ code: 'OWNERSHIP_CONFLICT', status: 409 });
  });

  it('denies faculty without a current lead membership on the research profile', async () => {
    const deps = baseDeps({
      memberModel: { find: vi.fn(() => chain([])) },
    });

    await expect(
      createFacultyOpportunityDraft(
        'faculty1',
        completeInput,
        'faculty-opportunity-key-no-owner',
        deps as any,
      ),
    ).rejects.toMatchObject({ code: 'OWNERSHIP_REQUIRED', status: 403 });
  });
});

describe('facultyOpportunityService lifecycle', () => {
  it('persists one private draft, keeps retries idempotent, and tolerates optional index failure', async () => {
    const pathwayModel: any = {
      create: vi.fn(async (value) => value),
      deleteOne: vi.fn(async () => ({})),
    };
    const createdDoc = {
      _id: ids.opportunity,
      entryPathwayId: ids.pathway,
      ...completeInput,
      submissionStatus: 'DRAFT',
      review: { status: 'unreviewed' },
      revision: 0,
      auditHistory: [],
      toObject() {
        return this;
      },
    };
    const opportunityModel: any = {
      findOne: vi.fn().mockReturnValueOnce(chain(null)).mockReturnValueOnce(chain(createdDoc)),
      create: vi.fn(async () => createdDoc),
    };
    const syncPathway = vi.fn(async () => {
      throw new Error('optional Meilisearch outage');
    });
    const deps = baseDeps({ opportunityModel, pathwayModel, syncPathway });

    const first = await createFacultyOpportunityDraft(
      'faculty1',
      completeInput,
      'faculty-opportunity-key-3',
      deps as any,
    );
    const retry = await createFacultyOpportunityDraft(
      'faculty1',
      completeInput,
      'faculty-opportunity-key-3',
      deps as any,
    );

    expect(first.created).toBe(true);
    expect(retry.created).toBe(false);
    expect(first.opportunity.workflowState).toBe('DRAFT');
    expect(pathwayModel.create).toHaveBeenCalledTimes(1);
    expect(opportunityModel.create).toHaveBeenCalledTimes(1);
    expect(syncPathway).toHaveBeenCalledTimes(1);
  });

  it('submits with a revision CAS and activates the private linked pathway for review', async () => {
    const current = {
      _id: ids.opportunity,
      entryPathwayId: ids.pathway,
      createdByUserId: ids.user,
      ...completeInput,
      archived: false,
      submissionStatus: 'DRAFT',
      review: { status: 'unreviewed' },
      revision: 4,
    };
    const submitted = {
      ...current,
      submissionStatus: 'PENDING_REVIEW',
      submittedAt: new Date('2026-07-14T12:00:00.000Z'),
      revision: 5,
    };
    const opportunityModel: any = {
      findOne: vi.fn(() => chain(current)),
      findOneAndUpdate: vi.fn(() => chain(submitted)),
    };
    const pathwayModel: any = { updateOne: vi.fn(async () => ({ modifiedCount: 1 })) };
    const session = { id: 'submit-session' };
    const transaction = vi.fn(async (work: (value: any) => Promise<unknown>) => work(session));
    const deps = baseDeps({ opportunityModel, pathwayModel, transaction });

    const result = await submitFacultyOpportunity(
      'faculty1',
      ids.opportunity.toHexString(),
      4,
      deps as any,
    );

    expect(result.workflowState).toBe('PENDING_REVIEW');
    expect(pathwayModel.updateOne.mock.calls[0][1].$set).toMatchObject({
      status: 'ACTIVE',
      archived: false,
      'review.status': 'unreviewed',
    });
    expect(opportunityModel.findOneAndUpdate.mock.calls[0][0]).toMatchObject({ revision: 4 });
    expect(opportunityModel.findOneAndUpdate.mock.calls[0][1].$inc).toEqual({ revision: 1 });
    expect(opportunityModel.findOneAndUpdate.mock.calls[0][2]).toMatchObject({ session });
    expect(pathwayModel.updateOne.mock.calls[0][2]).toMatchObject({ session });
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('fails a stale submission clearly without making it student-publishable', async () => {
    const current = {
      _id: ids.opportunity,
      entryPathwayId: ids.pathway,
      createdByUserId: ids.user,
      ...completeInput,
      archived: false,
      submissionStatus: 'DRAFT',
      review: { status: 'unreviewed' },
      revision: 5,
    };
    const opportunityModel: any = {
      findOne: vi.fn(() => chain(current)),
      findOneAndUpdate: vi.fn(() => chain(null)),
    };
    const pathwayModel: any = { updateOne: vi.fn(async () => ({ modifiedCount: 1 })) };

    await expect(
      submitFacultyOpportunity(
        'faculty1',
        ids.opportunity.toHexString(),
        4,
        baseDeps({ opportunityModel, pathwayModel }) as any,
      ),
    ).rejects.toMatchObject({ code: 'STALE_REVISION', status: 409 });

    expect(pathwayModel.updateOne).not.toHaveBeenCalled();
  });

  it('closes and archives atomically without deleting provenance', async () => {
    const current = {
      _id: ids.opportunity,
      entryPathwayId: ids.pathway,
      createdByUserId: ids.user,
      ...completeInput,
      archived: false,
      submissionStatus: 'REVIEWED',
      review: { status: 'approved' },
      revision: 6,
    };
    const pathwayModel: any = { updateOne: vi.fn(async () => ({ modifiedCount: 1 })) };
    const opportunityModel: any = {
      findOne: vi.fn(() => chain(current)),
      findOneAndUpdate: vi.fn(() =>
        chain({ ...current, status: 'CLOSED', closedAt: new Date(), revision: 7 }),
      ),
      deleteOne: vi.fn(),
    };
    const deps = baseDeps({ opportunityModel, pathwayModel });

    const closed = await closeFacultyOpportunity(
      'faculty1',
      ids.opportunity.toHexString(),
      6,
      deps as any,
    );

    expect(closed.workflowState).toBe('CLOSED');
    expect(opportunityModel.findOneAndUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      pathwayModel.updateOne.mock.invocationCallOrder[0],
    );
    expect(pathwayModel.updateOne.mock.calls[0][1].$set).toMatchObject({
      status: 'NOT_CURRENTLY_AVAILABLE',
      archived: false,
    });
    expect(opportunityModel.deleteOne).not.toHaveBeenCalled();

    opportunityModel.findOne.mockReturnValue(
      chain({ ...current, status: 'CLOSED', closedAt: new Date(), revision: 7 }),
    );
    opportunityModel.findOneAndUpdate.mockReturnValue(
      chain({ ...current, status: 'ARCHIVED', archived: true, revision: 8 }),
    );
    const archived = await archiveFacultyOpportunity(
      'faculty1',
      ids.opportunity.toHexString(),
      7,
      deps as any,
    );

    expect(archived.workflowState).toBe('ARCHIVED');
    expect(pathwayModel.updateOne.mock.calls[1][1].$set).toMatchObject({
      status: 'NOT_CURRENTLY_AVAILABLE',
      archived: true,
    });
    expect(opportunityModel.deleteOne).not.toHaveBeenCalled();
  });
});
