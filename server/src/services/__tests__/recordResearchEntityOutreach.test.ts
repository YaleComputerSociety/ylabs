import { beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

const mocks = vi.hoisted(() => ({
  researchEntityFindOne: vi.fn(),
  studentTrackingFindOneAndUpdate: vi.fn(),
  studentOutreachCreate: vi.fn(),
}));

vi.mock('../../models/researchEntity', () => ({
  ResearchEntity: {
    findOne: mocks.researchEntityFindOne,
  },
}));

vi.mock('../../models/studentTracking', () => ({
  StudentTracking: {
    findOneAndUpdate: mocks.studentTrackingFindOneAndUpdate,
  },
}));

vi.mock('../../models/studentOutreach', () => ({
  StudentOutreach: {
    create: mocks.studentOutreachCreate,
  },
}));

import { recordResearchEntityOutreach } from '../researchGroupService';

const studentProfileId = new mongoose.Types.ObjectId().toHexString();
const entityId = new mongoose.Types.ObjectId();
const trackingId = new mongoose.Types.ObjectId();

describe('recordResearchEntityOutreach', () => {
  beforeEach(() => {
    mocks.researchEntityFindOne.mockReset();
    mocks.studentTrackingFindOneAndUpdate.mockReset();
    mocks.studentOutreachCreate.mockReset();
    mocks.studentTrackingFindOneAndUpdate.mockResolvedValue({ _id: trackingId });
    mocks.studentOutreachCreate.mockResolvedValue({});
  });

  const mockEntity = (overrides: Record<string, unknown> = {}) => {
    mocks.researchEntityFindOne.mockReturnValue({
      select: () => ({
        lean: async () => ({ _id: entityId, websiteUrl: 'https://lab.yale.edu', ...overrides }),
      }),
    });
  };

  it('records an official-route outreach when no delivery context is given', async () => {
    mockEntity();

    const result = await recordResearchEntityOutreach('a-lab', studentProfileId);

    expect(result).toEqual({ recorded: true, routeUrl: 'https://lab.yale.edu' });
    expect(mocks.studentOutreachCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryMethod: 'official-route',
        emailGeneratedByPlatform: false,
        templateVersion: 'official-route-v1',
      }),
    );
  });

  it('rejects an official-route outreach when the entity has no public website', async () => {
    mockEntity({ websiteUrl: undefined });

    await expect(recordResearchEntityOutreach('a-lab', studentProfileId)).rejects.toThrow(
      'NO_APPROVED_OUTREACH_ROUTE',
    );
    expect(mocks.studentOutreachCreate).not.toHaveBeenCalled();
  });

  it('records a mailto outreach with the platform-scaffolded template version', async () => {
    mockEntity({ websiteUrl: undefined });

    const result = await recordResearchEntityOutreach('a-lab', studentProfileId, {
      deliveryMethod: 'mailto',
      emailGeneratedByPlatform: true,
      templateVersion: 'student-intro-v1',
    });

    expect(result).toEqual({ recorded: true });
    expect(mocks.studentOutreachCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryMethod: 'mailto',
        emailGeneratedByPlatform: true,
        templateVersion: 'student-intro-v1',
      }),
    );
  });

  it('records a mailto outreach as not platform-generated when the scaffold fell back', async () => {
    mockEntity({ websiteUrl: undefined });

    await recordResearchEntityOutreach('a-lab', studentProfileId, {
      deliveryMethod: 'mailto',
      emailGeneratedByPlatform: false,
    });

    expect(mocks.studentOutreachCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryMethod: 'mailto',
        emailGeneratedByPlatform: false,
        templateVersion: '',
      }),
    );
  });

  it('rejects an invalid slug or student profile id before touching the database', async () => {
    await expect(recordResearchEntityOutreach('', studentProfileId)).rejects.toThrow(
      'INVALID_OUTREACH_REQUEST',
    );
    await expect(recordResearchEntityOutreach('a-lab', 'not-an-object-id')).rejects.toThrow(
      'INVALID_OUTREACH_REQUEST',
    );
    expect(mocks.researchEntityFindOne).not.toHaveBeenCalled();
  });

  it('rejects outreach for an entity that is not found or not student-visible', async () => {
    mocks.researchEntityFindOne.mockReturnValue({
      select: () => ({ lean: async () => null }),
    });

    await expect(recordResearchEntityOutreach('a-lab', studentProfileId)).rejects.toThrow(
      'OUTREACH_ENTITY_NOT_FOUND',
    );
  });
});
