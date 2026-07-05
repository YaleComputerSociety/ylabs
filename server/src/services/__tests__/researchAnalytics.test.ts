import { describe, expect, it } from 'vitest';
import { AnalyticsEventType } from '../../models/analytics';
import { emitResearchEvent } from '../researchAnalytics';
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
});
