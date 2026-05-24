import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import {
  getOpportunityApplicationState,
  getOpportunityDeadlineState,
  getOpportunityDetail,
} from '../opportunityDetailService';

const leanOneModel = (record: any, calls: any[] = []) => ({
  findOne: (filter: any, projection?: string) => {
    calls.push({ filter, projection });
    return {
      lean: async () => record,
    };
  },
});

const leanManyModel = (records: any[], calls: any[] = []) => ({
  find: (filter: any, projection?: string) => {
    calls.push({ filter, projection });
    return {
      sort: (sort: any) => ({
        lean: async () => {
          calls.push({ sort });
          return records;
        },
      }),
    };
  },
});

describe('opportunityDetailService', () => {
  it('returns null for invalid ids before querying models', async () => {
    const calls: any[] = [];

    const detail = await getOpportunityDetail('not-a-mongo-id', {
      opportunityModel: leanOneModel({}, calls) as any,
    });

    expect(detail).toBeNull();
    expect(calls).toEqual([]);
  });

  it('queries only non-archived PostedOpportunity records and returns null when missing', async () => {
    const calls: any[] = [];
    const id = new Types.ObjectId().toString();

    const detail = await getOpportunityDetail(id, {
      opportunityModel: leanOneModel(null, calls) as any,
    });

    expect(detail).toBeNull();
    expect(String(calls[0].filter._id)).toBe(id);
    expect(calls[0].filter.archived).toBe(false);
  });

  it('maps host entity, pathway, and evidence without exposing contact data', async () => {
    const opportunityId = new Types.ObjectId();
    const pathwayId = new Types.ObjectId();
    const entityId = new Types.ObjectId();
    const evidenceId = new Types.ObjectId();
    const opportunity = {
      _id: opportunityId,
      entryPathwayId: pathwayId,
      researchEntityId: entityId,
      title: 'Spring RA role',
      term: 'Spring 2026',
      deadline: new Date('2026-02-01T00:00:00.000Z'),
      applicationUrl: 'https://apply.example.invalid/role',
      status: 'OPEN',
      hoursPerWeek: 8,
      payRate: '$18/hour',
      compensationType: 'PAID',
      eligibility: 'Open to undergraduates.',
      sourceEvidenceIds: [evidenceId],
      sourceUrls: ['https://source.example.invalid/posting'],
      listingId: new Types.ObjectId(),
    };
    const pathway = {
      _id: pathwayId,
      pathwayType: 'POSTED_ROLE',
      status: 'ACTIVE',
      evidenceStrength: 'DIRECT',
      studentFacingLabel: 'Posted RA role',
      explanation: 'Apply through the official posting.',
      bestNextStep: 'Submit the application.',
      compensation: 'PAID',
      confidence: 0.9,
      sourceUrls: ['https://source.example.invalid/posting'],
    };
    const researchEntity = {
      _id: entityId,
      slug: 'example-lab',
      name: 'Example Lab',
      displayName: 'Example Lab',
      entityType: 'LAB',
      departments: ['Computer Science'],
      researchAreas: ['AI'],
      school: 'Example College',
      websiteUrl: 'https://lab.example.invalid',
      shortDescription: 'Studies practical systems.',
    };
    const evidence = [
      {
        _id: evidenceId,
        sourceName: 'ylabs-listing',
        sourceUrl: 'https://source.example.invalid/posting',
        field: 'postedOpportunity',
        value: {
          quote: 'Apply at the official page. Questions: hidden-contact@example.invalid',
        },
        confidence: 0.95,
        observedAt: new Date('2026-01-01T00:00:00.000Z'),
        email: 'hidden-contact@example.invalid',
      },
    ];

    const detail = await getOpportunityDetail(opportunityId.toString(), {
      opportunityModel: leanOneModel(opportunity) as any,
      pathwayModel: leanOneModel(pathway) as any,
      researchEntityModel: leanOneModel(researchEntity) as any,
      observationModel: leanManyModel(evidence) as any,
      now: new Date('2026-01-15T00:00:00.000Z'),
    });

    expect(detail).toMatchObject({
      _id: opportunityId.toString(),
      entryPathwayId: pathwayId.toString(),
      researchEntityId: entityId.toString(),
      title: 'Spring RA role',
      applicationUrl: 'https://apply.example.invalid/role',
      deadlineState: 'UPCOMING',
      applicationState: 'APPLY_NOW',
      applicationLabel: 'Apply now',
      provenance: 'LISTING_BRIDGED',
      provenanceLabel: 'Legacy YLabs listing signal',
      researchEntity: {
        slug: 'example-lab',
        name: 'Example Lab',
      },
      pathway: {
        _id: pathwayId.toString(),
        pathwayType: 'POSTED_ROLE',
        studentFacingLabel: 'Posted RA role',
      },
      sourceUrls: ['https://source.example.invalid/posting'],
    });
    expect(detail?.evidence[0]).toMatchObject({
      _id: evidenceId.toString(),
      sourceName: 'ylabs-listing',
      sourceUrl: 'https://source.example.invalid/posting',
      field: 'postedOpportunity',
      excerpt: 'Apply at the official page. Questions: [email redacted]',
      confidence: 0.95,
      observedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(JSON.stringify(detail)).not.toContain('hidden-contact@example.invalid');
  });

  it('filters forbidden Engineering profile URLs from opportunity detail sources', async () => {
    const opportunityId = new Types.ObjectId();
    const pathwayId = new Types.ObjectId();
    const entityId = new Types.ObjectId();
    const evidenceId = new Types.ObjectId();
    const blockedUrl =
      'https://engineering.yale.edu/research-and-faculty/faculty-directory/example-person';
    const safeProfileUrl = 'https://example-profile.test/';

    const detail = await getOpportunityDetail(opportunityId.toString(), {
      opportunityModel: leanOneModel({
        _id: opportunityId,
        entryPathwayId: pathwayId,
        researchEntityId: entityId,
        title: 'Exploratory route',
        applicationUrl: blockedUrl,
        status: 'OPEN',
        sourceEvidenceIds: [evidenceId],
        sourceUrls: [blockedUrl, safeProfileUrl],
      }) as any,
      pathwayModel: leanOneModel({
        _id: pathwayId,
        pathwayType: 'EXPLORATORY_CONTACT',
        status: 'PLAUSIBLE',
        studentFacingLabel: 'Explore the PI profile',
        sourceUrls: [blockedUrl],
      }) as any,
      researchEntityModel: leanOneModel({
        _id: entityId,
        slug: 'example-research-home',
        name: 'Example Research Home',
        departments: ['Computer Science'],
        researchAreas: ['Algorithms'],
        websiteUrl: blockedUrl,
        sourceUrls: [blockedUrl, safeProfileUrl],
      }) as any,
      observationModel: leanManyModel([
        {
          _id: evidenceId,
          sourceName: 'dept-faculty-roster',
          sourceUrl: blockedUrl,
          field: 'profileUrls',
          value: { departmental: blockedUrl },
          confidence: 0.7,
          observedAt: new Date('2026-05-14T00:00:00.000Z'),
        },
      ]) as any,
      now: new Date('2026-05-15T00:00:00.000Z'),
    });

    expect(detail?.applicationUrl).toBeUndefined();
    expect(detail?.applicationState).toBe('NO_APPLICATION_URL');
    expect(detail?.sourceUrls).toEqual([safeProfileUrl]);
    expect(detail?.researchEntity.websiteUrl).toBe(safeProfileUrl);
    expect(detail?.pathway.sourceUrls).toEqual([]);
    expect(detail?.evidence[0].sourceUrl).toBeUndefined();
  });

  it('derives closed and rolling application states from status, deadline, and URL', () => {
    const now = new Date('2026-05-14T12:00:00.000Z');

    expect(getOpportunityDeadlineState('OPEN', undefined, now)).toBe('NO_DEADLINE');
    expect(getOpportunityDeadlineState('OPEN', new Date('2026-05-14T18:00:00.000Z'), now)).toBe(
      'DUE_TODAY',
    );
    expect(getOpportunityDeadlineState('OPEN', new Date('2026-05-13T00:00:00.000Z'), now)).toBe(
      'PAST',
    );
    expect(getOpportunityApplicationState('ROLLING', 'NO_DEADLINE', 'https://apply.edu')).toBe(
      'ROLLING',
    );
    expect(getOpportunityApplicationState('OPEN', 'PAST', 'https://apply.edu')).toBe('CLOSED');
    expect(getOpportunityApplicationState('OPEN', 'UPCOMING')).toBe('NO_APPLICATION_URL');
  });
});
