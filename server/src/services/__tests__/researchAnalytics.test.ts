import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AnalyticsEventType } from '../../models/analytics';
import { emitResearchEvent } from '../researchAnalytics';
import type { LogEventParams } from '../analyticsService';

const user = { netId: 'abc123', userType: 'undergraduate' };

void describe('research analytics event emission', () => {
  void it('emits research view events for canonical entities', async () => {
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

    assert.equal(emitted, true);
    assert.deepEqual(events[0], {
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

  void it('emits canonical research surface events with safe common fields', async () => {
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

    assert.equal(emitted, true);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], {
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

  void it('reduces contact-route clicks to method categories without private addresses', async () => {
    const events: LogEventParams[] = [];

    await emitResearchEvent(
      {
        eventType: AnalyticsEventType.CONTACT_ROUTE_CLICK,
        entityType: 'listing',
        entityId: '507f1f77bcf86cd799439011',
        user,
        payload: {
          contactMethod: 'email',
          email: 'mentor@yale.edu',
          label: 'Email mentor@yale.edu',
        },
      },
      async (event) => {
        events.push(event);
      },
    );

    assert.deepEqual(events[0].metadata, { contactMethod: 'email' });
    assert.equal(JSON.stringify(events[0]).includes('mentor@yale.edu'), false);
  });

  void it('stores only source category and hostname for source-link clicks', async () => {
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

    assert.deepEqual(events[0].metadata, {
      sourceCategory: 'publication',
      sourceHost: 'example.edu',
    });
    assert.equal(JSON.stringify(events[0]).includes('/private/path'), false);
    assert.equal(JSON.stringify(events[0]).includes('secret'), false);
  });

  void it('emits pathway save events and rejects invalid research event inputs', async () => {
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

    assert.equal(emitted, true);
    assert.equal(invalidEmitted, false);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].metadata, {
      action: 'stage_change',
      stage: 'Interviewing',
    });
  });
});
