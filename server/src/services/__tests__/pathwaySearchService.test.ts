import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  aggregate: vi.fn(),
}));

vi.mock('../../models/entryPathway', () => ({
  EntryPathway: {
    aggregate: mocks.aggregate,
  },
}));

import {
  getBestNextStepCategory,
  pathwayBestNextStepCategories,
  searchPathways,
} from '../pathwaySearchService';

describe('pathwaySearchService', () => {
  beforeEach(() => {
    mocks.aggregate.mockReset();
  });

  it('keeps the public best-next-step categories stable', () => {
    expect(pathwayBestNextStepCategories).toEqual([
      'apply',
      'find-funding',
      'plan-outreach',
      'contact-program',
      'save-for-later',
      'check-back-later',
    ]);
  });

  it('maps posted roles and active opportunities to apply', () => {
    expect(getBestNextStepCategory({ pathwayType: 'POSTED_ROLE' })).toBe('apply');
    expect(
      getBestNextStepCategory({
        pathwayType: 'EXPLORATORY_CONTACT',
        activePostedOpportunity: { _id: 'opportunity-1' },
      }),
    ).toBe('apply');
    expect(
      getBestNextStepCategory({
        pathwayType: 'EXPLORATORY_CONTACT',
        contactRoute: { routeType: 'OFFICIAL_APPLICATION' },
      }),
    ).toBe('apply');
  });

  it('leaves formalization-only pathway values non-actionable', () => {
    expect(getBestNextStepCategory({ pathwayType: 'COURSE_CREDIT' })).toBe(
      'save-for-later',
    );
    expect(getBestNextStepCategory({ pathwayType: 'SENIOR_THESIS' })).toBe(
      'save-for-later',
    );
    expect(getBestNextStepCategory({ pathwayType: 'FELLOWSHIP_FUNDED_PROJECT' })).toBe(
      'save-for-later',
    );
  });

  it('maps program-like public contact routes before generic outreach', () => {
    expect(
      getBestNextStepCategory({
        pathwayType: 'UNKNOWN',
        contactRoute: { routeType: 'PROGRAM_MANAGER' },
      }),
    ).toBe('contact-program');
  });

  it('maps exploratory routes without a posted opportunity to plan outreach', () => {
    expect(getBestNextStepCategory({ pathwayType: 'EXPLORATORY_CONTACT' })).toBe(
      'plan-outreach',
    );
    expect(getBestNextStepCategory({ pathwayType: 'VOLUNTEER_OUTREACH' })).toBe(
      'plan-outreach',
    );
    expect(getBestNextStepCategory({ pathwayType: 'FACULTY_SUPERVISION' })).toBe(
      'plan-outreach',
    );
  });

  it('keeps unavailable or thin-evidence pathways out of action-oriented CTAs', () => {
    expect(getBestNextStepCategory({ status: 'NOT_CURRENTLY_AVAILABLE' })).toBe(
      'check-back-later',
    );
    expect(getBestNextStepCategory({ status: 'NO_EVIDENCE' })).toBe('save-for-later');
    expect(getBestNextStepCategory({ status: 'HISTORICAL' })).toBe('save-for-later');
  });

  it('redacts direct contact details from Mongo pathway search hits', async () => {
    mocks.aggregate.mockReturnValue({
      exec: async () => [
        {
          hits: [
            {
              _id: '67d8928150621bcef434a1d5',
              pathwayType: 'EXPLORATORY_CONTACT',
              status: 'PLAUSIBLE',
              evidenceStrength: 'MODERATE',
              studentFacingLabel: 'Email hidden@example.edu about openings',
              explanation: 'Call 203-555-1212 before outreach.',
              bestNextStep: 'Ask hidden@example.edu about a first meeting.',
              bestNextStepCategory: 'plan-outreach',
              compensation: 'UNKNOWN',
              confidence: 0.7,
              sourceUrls: [
                'https://lab.example.edu/pathway',
                'https://user:pass@example.edu/private',
                'mailto:hidden@example.edu',
              ],
              researchEntity: {
                _id: 'entity-1',
                slug: 'example-lab',
                name: 'Example Lab',
                departments: ['Computer Science'],
                researchAreas: ['AI'],
                studentVisibilityTier: 'student_ready',
                websiteUrl: 'https://user:pass@example.edu/entity',
              },
              activePostedOpportunity: {
                _id: '67d8928150621bcef434a1d6',
                title: 'Email hidden@example.edu to apply',
                applicationUrl: 'https://user:pass@example.edu/apply',
                status: 'OPEN',
                term: 'Spring 2026',
              },
              evidence: [
                {
                  signalType: 'CONTACT_INSTRUCTIONS_EXIST',
                  confidence: 'HIGH',
                  excerpt: 'Questions go to hidden@example.edu or 203-555-1212.',
                  sourceUrl: 'https://user:pass@example.edu/evidence',
                },
              ],
              contactRoute: {
                routeType: 'FACULTY_PI',
                label: 'Professor hidden@example.edu',
                url: 'https://user:pass@example.edu/contact',
                contactPolicy: 'DIRECT_CONTACT_OK',
                visibility: 'PUBLIC',
                rationale: 'Use 203-555-1212 for urgent questions.',
              },
            },
          ],
          total: [{ count: 1 }],
        },
      ],
    });

    const result = await searchPathways({ page: 1, pageSize: 10 });
    const hit = result.hits[0];

    expect(hit.studentFacingLabel).toBe('Email [email redacted] about openings');
    expect(hit.explanation).toBe('Call [phone redacted] before outreach.');
    expect(hit.bestNextStep).toBe('Ask [email redacted] about a first meeting.');
    expect(hit.sourceUrls).toEqual(['https://lab.example.edu/pathway']);
    expect(hit.activePostedOpportunity).toEqual(
      expect.objectContaining({
        title: 'Email [email redacted] to apply',
      }),
    );
    expect(hit.activePostedOpportunity).not.toHaveProperty('applicationUrl');
    expect(hit.evidence[0]).toEqual(
      expect.objectContaining({
        excerpt: 'Questions go to [email redacted] or [phone redacted].',
      }),
    );
    expect(hit.evidence[0]).not.toHaveProperty('sourceUrl');
    expect(hit.researchEntity.websiteUrl).toBeUndefined();
    expect(hit.contactRoute).toEqual(
      expect.objectContaining({
        label: 'Professor [email redacted]',
        rationale: 'Use [phone redacted] for urgent questions.',
      }),
    );
    expect(hit.contactRoute).not.toHaveProperty('url');
    expect(JSON.stringify(hit)).not.toContain('hidden@example.edu');
    expect(JSON.stringify(hit)).not.toContain('203-555-1212');
    expect(JSON.stringify(hit)).not.toContain('user:pass');
  });

  it('caps page before building Mongo pathway search skip stages', async () => {
    mocks.aggregate.mockReturnValue({
      exec: async () => [{ hits: [], total: [{ count: 0 }] }],
    });

    const result = await searchPathways({ page: 999_999_999, pageSize: 500 });

    const pipeline = mocks.aggregate.mock.calls[0][0];
    const facetStage = pipeline.find((stage: any) => stage.$facet);
    expect(facetStage.$facet.hits).toEqual(
      expect.arrayContaining([
        { $skip: 99_900 },
        { $limit: 100 },
      ]),
    );
    expect(result).toMatchObject({
      hits: [],
      estimatedTotalHits: 0,
      page: 1000,
      pageSize: 100,
    });
  });
});
