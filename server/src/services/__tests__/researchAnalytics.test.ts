import { describe, expect, it } from 'vitest';
import { AnalyticsEventType } from '../../models/analytics';
import { emitResearchEvent, sanitizeResearchPayload } from '../researchAnalytics';
import type { LogEventParams } from '../analyticsService';

const user = { netId: 'abc123', userType: 'undergraduate' };

describe('research analytics event emission', () => {
  it('emits research view events for canonical entities', async () => {
    const events: LogEventParams[] = [];

    const emitted = await emitResearchEvent(
      {
        eventType: AnalyticsEventType.RESEARCH_VIEW,
        entityType: 'listing',
        entityId: '507f1f77bcf86cd799439010',
        user,
        payload: { surface: 'detail' },
      },
      async (event) => {
        events.push(event);
      },
    );

    expect(emitted).toBe(true);
    expect(events[0]).toEqual({
      eventType: AnalyticsEventType.RESEARCH_VIEW,
      netid: 'abc123',
      userType: 'undergraduate',
      entityType: 'listing',
      entityId: '507f1f77bcf86cd799439010',
      metadata: {
        surface: 'detail',
      },
    });
  });

  it('emits canonical research surface events with safe common fields', async () => {
    const events: LogEventParams[] = [];

    const emitted = await emitResearchEvent(
      {
        eventType: AnalyticsEventType.WAYS_IN_CLICK,
        entityType: 'profile',
        entityId: 'fac123',
        user,
        payload: {
          waysInKind: 'best_next_step',
          label: 'Read recent publications',
          ignoredRawContact: 'professor@example.edu',
        },
      },
      async (event) => {
        events.push(event);
      },
    );

    expect(emitted).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      eventType: AnalyticsEventType.WAYS_IN_CLICK,
      netid: 'abc123',
      userType: 'undergraduate',
      entityType: 'profile',
      entityId: 'fac123',
      metadata: {
        waysInKind: 'best_next_step',
        label: 'Read recent publications',
      },
    });
  });

  it('reduces contact-route clicks to method categories without private addresses', async () => {
    const events: LogEventParams[] = [];

    await emitResearchEvent(
      {
        eventType: AnalyticsEventType.CONTACT_ROUTE_CLICK,
        entityType: 'listing',
        entityId: '507f1f77bcf86cd799439011',
        user,
        payload: {
          contactMethod: 'email',
          email: 'fixture-mentor@yale.edu',
          label: 'Email fixture-mentor@yale.edu',
        },
      },
      async (event) => {
        events.push(event);
      },
    );

    expect(events[0].metadata).toEqual({ contactMethod: 'email' });
    expect(JSON.stringify(events[0])).not.toContain('fixture-mentor@yale.edu');
  });

  it('stores only source category and hostname for source-link clicks', async () => {
    const events: LogEventParams[] = [];

    await emitResearchEvent(
      {
        eventType: AnalyticsEventType.SOURCE_LINK_CLICK,
        entityType: 'fellowship',
        entityId: '507f1f77bcf86cd799439012',
        user,
        payload: {
          sourceCategory: 'publication',
          url: 'https://www.example.edu/private/path?token=secret#fragment',
        },
      },
      async (event) => {
        events.push(event);
      },
    );

    expect(events[0].metadata).toEqual({
      sourceCategory: 'publication',
      sourceHost: 'example.edu',
    });
    expect(JSON.stringify(events[0])).not.toContain('/private/path');
    expect(JSON.stringify(events[0])).not.toContain('secret');
  });

  it('emits pathway save events and rejects invalid research event inputs', async () => {
    const events: LogEventParams[] = [];

    const emitted = await emitResearchEvent(
      {
        eventType: AnalyticsEventType.PATHWAY_SAVE,
        entityType: 'listing',
        entityId: '507f1f77bcf86cd799439013',
        user,
        payload: {
          action: 'stage_change',
          stage: 'Interviewing',
        },
      },
      async (event) => {
        events.push(event);
      },
    );

    const invalidEmitted = await emitResearchEvent(
      {
        eventType: 'listing_view',
        entityType: 'listing',
        entityId: '507f1f77bcf86cd799439013',
        user,
      },
      async (event) => {
        events.push(event);
      },
    );

    expect(emitted).toBe(true);
    expect(invalidEmitted).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0].metadata).toEqual({
      action: 'stage_change',
      stage: 'Interviewing',
    });
  });

  it('records one privacy-bounded search outcome without raw query or downstream identifiers', async () => {
    const events: LogEventParams[] = [];

    await emitResearchEvent(
      {
        eventType: AnalyticsEventType.RESEARCH_SEARCH,
        user,
        entityType: undefined,
        entityId: undefined,
        dedupeKey: 'search:fixture-1',
        payload: {
          outcome: 'zero_results',
          resultCountBucket: '0',
          searchKind: 'filtered',
          filterCountBucket: '2',
          query: 'private mentor email fixture-mentor@yale.edu',
          searchId: 'join-me-to-an-action',
        },
      },
      async (event) => {
        events.push(event);
      },
    );

    expect(events).toEqual([
      {
        eventType: AnalyticsEventType.RESEARCH_SEARCH,
        netid: 'abc123',
        userType: 'undergraduate',
        metadata: {
          outcome: 'zero_results',
          resultCountBucket: '0',
          searchKind: 'filtered',
          filterCountBucket: '2',
        },
        dedupeKey: 'search:fixture-1',
      },
    ]);
    expect(JSON.stringify(events)).not.toContain('fixture-mentor');
    expect(JSON.stringify(events)).not.toContain('searchId');
  });

  it.each([
    [AnalyticsEventType.RESEARCH_ENTITY_IMPRESSION, { surface: 'search', positionBucket: '4-10' }],
    [AnalyticsEventType.RESEARCH_PROFILE_OPEN, { source: 'direct' }],
    [AnalyticsEventType.RESEARCH_SOURCE_REVIEW, { sourceCategory: 'publication' }],
    [AnalyticsEventType.RESEARCH_SAVE, { operation: 'remove', surface: 'saved_plans' }],
    [AnalyticsEventType.RESEARCH_COMPARE, { entityCountBucket: '3-4' }],
    [AnalyticsEventType.RESEARCH_PLAN_UPDATE, { field: 'note_presence' }],
  ])('allowlists %s payloads without free text', (eventType, expected) => {
    expect(
      sanitizeResearchPayload(eventType, {
        ...expected,
        note: 'private planning note',
        email: 'fixture-mentor@yale.edu',
        url: 'https://example.edu/private?student=abc123',
        query: 'raw research query',
      }),
    ).toEqual(expected);
  });

  it('keeps filter changes non-converting and bounded', () => {
    expect(
      sanitizeResearchPayload(AnalyticsEventType.RESEARCH_FILTER_CHANGE, {
        operation: 'remove',
        filter: 'department',
        value: 'student-specific department value',
      }),
    ).toEqual({ operation: 'remove', filter: 'department' });
  });

  it('emits a qualified action only from the current server-owned category', async () => {
    const events: LogEventParams[] = [];
    const resolve = async () =>
      new Map([
        [
          '507f1f77bcf86cd799439010',
          {
            category: 'official_application' as const,
            label: 'Official application',
            url: 'https://example.edu/apply',
          },
        ],
      ]);

    const emitted = await emitResearchEvent(
      {
        eventType: AnalyticsEventType.RESEARCH_QUALIFIED_ACTION,
        entityType: 'research_entity',
        entityId: '507f1f77bcf86cd799439010',
        user,
        dedupeKey: 'action:fixture-1',
        payload: {
          actionCategory: 'official_application',
          query: 'must not join',
          url: 'https://example.edu/apply?student=abc123',
          destination: 'fixture-mentor@yale.edu',
          note: 'private plan',
        },
      },
      async (event) => {
        events.push(event);
      },
      resolve,
    );

    expect(emitted).toBe(true);
    expect(events[0]).toMatchObject({
      eventType: AnalyticsEventType.RESEARCH_QUALIFIED_ACTION,
      entityType: 'research_entity',
      entityId: '507f1f77bcf86cd799439010',
      metadata: { actionCategory: 'official_application' },
    });
    expect(JSON.stringify(events[0])).not.toContain('query');
    expect(JSON.stringify(events[0])).not.toContain('fixture-mentor');
    expect(JSON.stringify(events[0])).not.toContain('private plan');
  });

  it('rejects stale, missing, and client-mismatched qualified actions', async () => {
    const events: LogEventParams[] = [];
    const missing = async () => new Map();
    const qualified = async () =>
      new Map([
        [
          '507f1f77bcf86cd799439010',
          {
            category: 'reviewed_route' as const,
            label: 'Official contact route',
            url: 'https://example.edu/contact',
          },
        ],
      ]);

    await expect(
      emitResearchEvent(
        {
          eventType: AnalyticsEventType.RESEARCH_QUALIFIED_ACTION,
          entityType: 'research_entity',
          entityId: '507f1f77bcf86cd799439010',
          user,
          payload: { actionCategory: 'official_application' },
        },
        async (event) => {
          events.push(event);
        },
        qualified,
      ),
    ).resolves.toBe(false);
    await expect(
      emitResearchEvent(
        {
          eventType: AnalyticsEventType.RESEARCH_QUALIFIED_ACTION,
          entityType: 'research_entity',
          entityId: '507f1f77bcf86cd799439010',
          user,
        },
        async (event) => {
          events.push(event);
        },
        missing,
      ),
    ).resolves.toBe(false);
    expect(events).toHaveLength(0);
  });
});
