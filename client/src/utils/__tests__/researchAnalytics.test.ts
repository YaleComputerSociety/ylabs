import { afterEach, describe, expect, it, vi } from 'vitest';

import axios from '../axios';
import {
  researchCountBucket,
  researchPositionBucket,
  researchResultCountBucket,
  resetResearchAnalyticsDedupeForTests,
  trackResearchEvent,
  trackResearchEventOnce,
} from '../researchAnalytics';

vi.mock('../axios', () => ({
  default: {
    post: vi.fn(),
  },
}));

const post = (axios as unknown as { post: ReturnType<typeof vi.fn> }).post;

afterEach(() => {
  vi.clearAllMocks();
  resetResearchAnalyticsDedupeForTests();
});

describe('research journey analytics client', () => {
  it('sends the canonical search contract without raw query text', async () => {
    post.mockResolvedValue({ status: 202 });

    await trackResearchEvent({
      eventType: 'research_search',
      payload: {
        outcome: 'zero_results',
        resultCountBucket: '0',
        searchKind: 'query',
        filterCountBucket: '0',
      },
      dedupeKey: 'search:fixture-1',
    });

    expect(post).toHaveBeenCalledWith(
      '/analytics/research',
      {
        eventType: 'research_search',
        payload: {
          outcome: 'zero_results',
          resultCountBucket: '0',
          searchKind: 'query',
          filterCountBucket: '0',
        },
        dedupeKey: 'search:fixture-1',
      },
      { withCredentials: true },
    );
    expect(JSON.stringify(post.mock.calls[0][1])).not.toContain('queryText');
  });

  it.each([
    ['research_profile_open', { source: 'direct' }],
    ['research_source_review', { sourceCategory: 'publication' }],
    ['research_save', { operation: 'save', surface: 'profile' }],
    ['research_compare', { entityCountBucket: '2' }],
    ['research_plan_update', { field: 'note_presence' }],
    ['research_qualified_action', { actionCategory: 'official_application' }],
  ] as const)('sends %s as an entity-scoped event', async (eventType, payload) => {
    post.mockResolvedValue({ status: 202 });

    await trackResearchEvent({
      eventType,
      entityType: 'research_entity',
      entityId: '507f1f77bcf86cd799439011',
      payload,
      dedupeKey: `${eventType}:fixture-1`,
    });

    expect(post).toHaveBeenCalledWith(
      '/analytics/research',
      expect.objectContaining({
        eventType,
        entityType: 'research_entity',
        entityId: '507f1f77bcf86cd799439011',
        payload,
      }),
      { withCredentials: true },
    );
  });

  it('collapses Strict Mode and navigation replay keys', async () => {
    post.mockResolvedValue({ status: 202 });
    const event = {
      eventType: 'research_profile_open' as const,
      entityType: 'research_entity' as const,
      entityId: '507f1f77bcf86cd799439011',
      payload: { source: 'direct' as const },
    };

    await Promise.all([
      trackResearchEventOnce('profile:route1:entity1', event),
      trackResearchEventOnce('profile:route1:entity1', event),
    ]);

    expect(post).toHaveBeenCalledOnce();
  });

  it('swallows blocked-tracker and offline failures', async () => {
    post.mockRejectedValue(new Error('blocked'));

    await expect(
      trackResearchEvent({
        eventType: 'research_save',
        entityType: 'research_entity',
        entityId: '507f1f77bcf86cd799439011',
        payload: { operation: 'save', surface: 'profile' },
      }),
    ).resolves.toBeUndefined();
  });

  it('uses bounded result, position, and comparison buckets', () => {
    expect([0, 1, 6, 21, 51].map(researchResultCountBucket)).toEqual([
      '0',
      '1-5',
      '6-20',
      '21-50',
      '51+',
    ]);
    expect([1, 4, 11, 25].map(researchPositionBucket)).toEqual(['1-3', '4-10', '11-24', '25+']);
    expect([1, 2, 4, 5].map(researchCountBucket)).toEqual(['1', '2', '3-4', '5+']);
  });
});
