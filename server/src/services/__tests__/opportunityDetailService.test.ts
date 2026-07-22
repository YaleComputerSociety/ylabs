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

  it('returns null for object-shaped ids without invoking arbitrary toHexString', async () => {
    const calls: any[] = [];

    const detail = await getOpportunityDetail(
      {
        toHexString: () => {
          throw new Error('opportunity detail invoked arbitrary toHexString');
        },
      } as any,
      {
        opportunityModel: leanOneModel({}, calls) as any,
      },
    );

    expect(detail).toBeNull();
    expect(calls).toEqual([]);
  });

  it('queries only currently publishable PostedOpportunity records and returns null when missing', async () => {
    const calls: any[] = [];
    const id = new Types.ObjectId().toString();

    const detail = await getOpportunityDetail(id, {
      opportunityModel: leanOneModel(null, calls) as any,
    });

    expect(detail).toBeNull();
    expect(String(calls[0].filter._id)).toBe(id);
    expect(calls[0].filter.archived).toBe(false);
    expect(calls[0].filter.status).toEqual({ $in: ['OPEN', 'ROLLING'] });
    expect(calls[0].filter['review.status']).toBe('approved');
    expect(calls[0].filter.$or).toEqual([
      { deadline: { $exists: false } },
      { deadline: null },
      { deadline: { $gte: expect.any(Date) } },
    ]);
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
      description: 'Work with hidden@example.edu on image analysis and research documentation.',
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
        pathwayType: 'POSTED_ROLE',
        studentFacingLabel: 'Posted RA role',
        bestNextStep: 'Email [email redacted] after reviewing the application.',
      },
      sourceUrls: ['https://source.example.edu/posting'],
    });
    expect(detail).not.toHaveProperty('_id');
    expect(detail).not.toHaveProperty('entryPathwayId');
    expect(detail).not.toHaveProperty('researchEntityId');
    expect(detail).not.toHaveProperty('listingId');
    expect(detail?.researchEntity).not.toHaveProperty('_id');
    expect(detail?.pathway).not.toHaveProperty('_id');
    expect(detail?.evidence[0]).toEqual({
      sourceName: 'ylabs-listing',
      sourceUrl: 'https://source.example.edu/posting',
      field: 'postedOpportunity',
      excerpt: 'Apply at the official page. Questions: [email redacted]',
      confidence: 0.95,
      observedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(detail?.evidence[0]).not.toHaveProperty('_id');
    expect(detail?.eligibility).toBe('Open to Yale undergraduates. Questions: [email redacted]');
    expect(detail?.description).toBe(
      'Work with [email redacted] on image analysis and research documentation.',
    );
    expect(JSON.stringify(detail)).not.toContain('hidden@example.edu');
    expect(JSON.stringify(detail)).not.toContain(pathwayId.toString());
    expect(JSON.stringify(detail)).not.toContain(entityId.toString());
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
        departments: ['Contact hidden-dept@example.edu', 'History'],
        researchAreas: ['Call 203-555-1212', 'Archives'],
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
        departments: ['Contact [email redacted]', 'History'],
        researchAreas: ['Call [phone redacted]', 'Archives'],
      },
      pathway: {
        sourceUrls: ['https://pathway.example.edu/'],
      },
    });
    expect(detail?.evidence[0]?.sourceUrl).toBeUndefined();
    expect(JSON.stringify(detail)).not.toContain('javascript:');
    expect(JSON.stringify(detail)).not.toContain('data:text/html');
    expect(JSON.stringify(detail)).not.toContain('mailto:');
    expect(JSON.stringify(detail)).not.toContain('hidden-dept@example.edu');
    expect(JSON.stringify(detail)).not.toContain('203-555-1212');
  });

  it('bounds public detail shaping without stringifying polluted stored values', async () => {
    const opportunityId = new Types.ObjectId();
    const pathwayId = new Types.ObjectId();
    const entityId = new Types.ObjectId();
    const evidenceId = new Types.ObjectId();
    const sourceUrls = Array.from(
      { length: 50 },
      (_, index) => `https://source.example.edu/posting/${index}`,
    );
    Object.defineProperty(sourceUrls, '50', {
      get: () => {
        throw new Error('opportunity detail read past the source URL cap');
      },
      enumerable: true,
    });
    const departments = Array.from({ length: 50 }, (_, index) => `Department ${index}`);
    Object.defineProperty(departments, '50', {
      get: () => {
        throw new Error('opportunity detail read past the taxonomy cap');
      },
      enumerable: true,
    });
    const evidenceArray = Array.from({ length: 50 }, (_, index) => `Evidence ${index}`);
    Object.defineProperty(evidenceArray, '50', {
      get: () => {
        throw new Error('opportunity detail read past the evidence cap');
      },
      enumerable: true,
    });

    const detail = await getOpportunityDetail(opportunityId.toString(), {
      opportunityModel: leanOneModel({
        _id: opportunityId,
        entryPathwayId: {
          toString: () => {
            throw new Error('opportunity detail stringified an arbitrary entryPathwayId');
          },
        },
        researchEntityId: entityId,
        title: 'x'.repeat(6000),
        applicationUrl: {
          toString: () => {
            throw new Error('opportunity detail stringified an arbitrary applicationUrl');
          },
        },
        status: 'OPEN',
        sourceEvidenceIds: [evidenceId],
        sourceUrls,
      }) as any,
      pathwayModel: leanOneModel({
        _id: pathwayId,
        pathwayType: 'POSTED_ROLE',
        status: 'ACTIVE',
        studentFacingLabel: 'Posted role',
        sourceEvidenceIds: [evidenceId],
        sourceUrls: [],
      }) as any,
      researchEntityModel: leanOneModel({
        _id: entityId,
        slug: 'bounded-detail-lab',
        name: 'Bounded Detail Lab',
        departments,
        researchAreas: [],
        websiteUrl: {
          toString: () => {
            throw new Error('opportunity detail stringified an arbitrary websiteUrl');
          },
        },
      }) as any,
      observationModel: leanManyModel([
        {
          _id: evidenceId,
          sourceName: 'scraper',
          sourceUrl: 'https://source.example.edu/evidence',
          field: 'postedOpportunity',
          value: evidenceArray,
          confidence: 0.8,
        },
      ]) as any,
      now: new Date('2026-01-15T00:00:00.000Z'),
    });

    expect(detail).not.toHaveProperty('_id');
    expect(detail).not.toHaveProperty('entryPathwayId');
    expect(detail?.title).toHaveLength(5000);
    expect(detail?.applicationUrl).toBeUndefined();
    expect(detail?.sourceUrls).toHaveLength(50);
    expect(detail?.researchEntity.departments).toHaveLength(50);
    expect(detail?.researchEntity.websiteUrl).toBeUndefined();
    expect(detail?.evidence[0].excerpt).toContain('Evidence 0 Evidence 1');
    expect(detail?.evidence[0].excerpt?.length).toBeLessThanOrEqual(360);
  });

  it('skips object-shaped evidence ids without invoking arbitrary toHexString', async () => {
    const opportunityId = new Types.ObjectId();
    const pathwayId = new Types.ObjectId();
    const entityId = new Types.ObjectId();
    const evidenceId = new Types.ObjectId();
    const observationCalls: any[] = [];

    await getOpportunityDetail(opportunityId.toString(), {
      opportunityModel: leanOneModel({
        _id: opportunityId,
        entryPathwayId: pathwayId,
        researchEntityId: entityId,
        title: 'Evidence role',
        status: 'OPEN',
        sourceEvidenceIds: [
          {
            toHexString: () => {
              throw new Error('opportunity detail invoked arbitrary evidence toHexString');
            },
          },
          evidenceId,
        ],
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
      researchEntityModel: leanOneModel({
        _id: entityId,
        slug: 'evidence-lab',
        name: 'Evidence Lab',
        studentVisibilityTier: 'student_ready',
      }) as any,
      observationModel: leanManyModel([], observationCalls) as any,
      now: new Date('2026-01-15T00:00:00.000Z'),
    });

    expect(observationCalls[0].filter._id.$in.map(String)).toEqual([evidenceId.toString()]);
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
