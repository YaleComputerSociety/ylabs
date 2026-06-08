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

  it('requires public student visibility for the host research entity', async () => {
    const opportunityId = new Types.ObjectId();
    const pathwayId = new Types.ObjectId();
    const entityId = new Types.ObjectId();
    const researchEntityCalls: any[] = [];

    const detail = await getOpportunityDetail(opportunityId.toString(), {
      opportunityModel: leanOneModel({
        _id: opportunityId,
        entryPathwayId: pathwayId,
        researchEntityId: entityId,
        title: 'Hidden entity role',
        status: 'OPEN',
        sourceEvidenceIds: [],
        sourceUrls: [],
      }) as any,
      pathwayModel: leanOneModel({
        _id: pathwayId,
        pathwayType: 'POSTED_ROLE',
        status: 'ACTIVE',
        studentFacingLabel: 'Posted role',
        sourceEvidenceIds: [],
        sourceUrls: [],
      }) as any,
      researchEntityModel: leanOneModel(null, researchEntityCalls) as any,
      observationModel: leanManyModel([]) as any,
    });

    expect(detail).toBeNull();
    expect(researchEntityCalls[0].filter).toMatchObject({
      _id: entityId,
      archived: { $ne: true },
      studentVisibilityTier: { $in: ['student_ready'] },
    });
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
      applicationUrl: 'https://apply.example.edu/role',
      status: 'OPEN',
      hoursPerWeek: 8,
      payRate: '$18/hour',
      compensationType: 'PAID',
      eligibility: 'Open to Yale undergraduates. Questions: hidden@example.edu',
      sourceEvidenceIds: [evidenceId],
      sourceUrls: ['https://source.example.edu/posting'],
      listingId: new Types.ObjectId(),
    };
    const pathway = {
      _id: pathwayId,
      pathwayType: 'POSTED_ROLE',
      status: 'ACTIVE',
      evidenceStrength: 'DIRECT',
      studentFacingLabel: 'Posted RA role',
      explanation: 'Apply through the official posting.',
      bestNextStep: 'Email hidden@example.edu after reviewing the application.',
      compensation: 'PAID',
      confidence: 0.9,
      sourceUrls: ['https://source.example.edu/posting'],
    };
    const researchEntity = {
      _id: entityId,
      slug: 'example-lab',
      name: 'Example Lab',
      displayName: 'Example Lab',
      entityType: 'LAB',
      departments: ['Computer Science'],
      researchAreas: ['AI'],
      school: 'Yale College',
      websiteUrl: 'https://lab.example.edu',
      shortDescription: 'Studies practical systems.',
    };
    const evidence = [
      {
        _id: evidenceId,
        sourceName: 'ylabs-listing',
        sourceUrl: 'https://source.example.edu/posting',
        field: 'postedOpportunity',
        value: {
          quote: 'Apply at the official page. Questions: hidden@example.edu',
        },
        confidence: 0.95,
        observedAt: new Date('2026-01-01T00:00:00.000Z'),
        email: 'hidden@example.edu',
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
      applicationUrl: 'https://apply.example.edu/role',
      deadlineState: 'UPCOMING',
      applicationState: 'APPLY_NOW',
      applicationLabel: 'Apply now',
      provenance: 'LISTING_BRIDGED',
      provenanceLabel: 'YLabs listing bridge',
      researchEntity: {
        slug: 'example-lab',
        name: 'Example Lab',
      },
      pathway: {
        _id: pathwayId.toString(),
        pathwayType: 'POSTED_ROLE',
        studentFacingLabel: 'Posted RA role',
        bestNextStep: 'Email [email redacted] after reviewing the application.',
      },
      sourceUrls: ['https://source.example.edu/posting'],
    });
    expect(detail?.evidence[0]).toEqual({
      _id: evidenceId.toString(),
      sourceName: 'ylabs-listing',
      sourceUrl: 'https://source.example.edu/posting',
      field: 'postedOpportunity',
      excerpt: 'Apply at the official page. Questions: [email redacted]',
      confidence: 0.95,
      observedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(detail?.eligibility).toBe('Open to Yale undergraduates. Questions: [email redacted]');
    expect(JSON.stringify(detail)).not.toContain('hidden@example.edu');
  });

  it('filters unsafe public URLs before deriving application state or source links', async () => {
    const opportunityId = new Types.ObjectId();
    const pathwayId = new Types.ObjectId();
    const entityId = new Types.ObjectId();
    const evidenceId = new Types.ObjectId();

    const detail = await getOpportunityDetail(opportunityId.toString(), {
      opportunityModel: leanOneModel({
        _id: opportunityId,
        entryPathwayId: pathwayId,
        researchEntityId: entityId,
        title: 'Unsafe URL role',
        applicationUrl: 'javascript:alert(1)',
        status: 'OPEN',
        sourceEvidenceIds: [evidenceId],
        sourceUrls: [
          'javascript:alert(1)',
          'https://source.example.edu/posting',
          'mailto:advisor@example.edu',
        ],
      }) as any,
      pathwayModel: leanOneModel({
        _id: pathwayId,
        pathwayType: 'POSTED_ROLE',
        status: 'ACTIVE',
        studentFacingLabel: 'Posted role',
        sourceEvidenceIds: [evidenceId],
        sourceUrls: ['data:text/html,<script>alert(1)</script>', 'https://pathway.example.edu'],
      }) as any,
      researchEntityModel: leanOneModel({
        _id: entityId,
        slug: 'unsafe-url-lab',
        name: 'Unsafe URL Lab',
        departments: [],
        researchAreas: [],
        websiteUrl: 'javascript:alert(1)',
        website: 'https://fallback.example.edu',
      }) as any,
      observationModel: leanManyModel([
        {
          _id: evidenceId,
          sourceName: 'scraper',
          sourceUrl: 'data:text/html,<script>alert(1)</script>',
          field: 'postedOpportunity',
          value: 'Apply through the linked posting.',
          confidence: 0.8,
        },
      ]) as any,
      now: new Date('2026-01-15T00:00:00.000Z'),
    });

    expect(detail).toMatchObject({
      applicationUrl: undefined,
      applicationState: 'NO_APPLICATION_URL',
      applicationLabel: 'Application route not listed',
      sourceUrls: ['https://source.example.edu/posting', 'https://pathway.example.edu/'],
      researchEntity: {
        websiteUrl: 'https://fallback.example.edu/',
      },
      pathway: {
        sourceUrls: ['https://pathway.example.edu/'],
      },
    });
    expect(detail?.evidence[0]?.sourceUrl).toBeUndefined();
    expect(JSON.stringify(detail)).not.toContain('javascript:');
    expect(JSON.stringify(detail)).not.toContain('data:text/html');
    expect(JSON.stringify(detail)).not.toContain('mailto:');
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
