import { describe, expect, it } from 'vitest';

import { AnalyticsEvent, AnalyticsEventType } from '../analytics';

describe('AnalyticsEvent model', () => {
  it('accepts the canonical student user type used by auth flows', async () => {
    const event = new AnalyticsEvent({
      eventType: AnalyticsEventType.LOGIN,
      netid: 'test123',
      userType: 'student',
    });

    await expect(event.validate()).resolves.toBeUndefined();
  });

  it('stores legacy faculty user types as professor', async () => {
    const event = new AnalyticsEvent({
      eventType: AnalyticsEventType.LOGIN,
      netid: 'faculty.fixture',
      userType: 'faculty',
    });

    await expect(event.validate()).resolves.toBeUndefined();
    expect(event.userType).toBe('professor');
  });

  it('declares one ascending timestamp index for TTL retention', () => {
    const ascendingTimestampIndexes = AnalyticsEvent.schema.indexes().filter(([fields]) => {
      const fieldNames = Object.keys(fields);
      return fieldNames.length === 1 && fields.timestamp === 1;
    });

    expect(ascendingTimestampIndexes).toHaveLength(1);
  });

  it('accepts canonical journey events and bounds idempotency keys', async () => {
    const event = new AnalyticsEvent({
      eventType: AnalyticsEventType.RESEARCH_QUALIFIED_ACTION,
      netid: 'test123',
      userType: 'undergraduate',
      entityType: 'research_entity',
      entityId: '507f1f77bcf86cd799439011',
      dedupeKey: 'action:fixture-1',
    });

    await expect(event.validate()).resolves.toBeUndefined();
    event.dedupeKey = 'x'.repeat(161);
    await expect(event.validate()).rejects.toThrow();
  });

  it('declares a per-actor unique idempotency index', () => {
    const dedupeIndex = AnalyticsEvent.schema
      .indexes()
      .find(([fields]) => fields.netid === 1 && fields.dedupeKey === 1);

    expect(dedupeIndex?.[1]).toMatchObject({
      unique: true,
      partialFilterExpression: { dedupeKey: { $type: 'string' } },
    });
  });
});
