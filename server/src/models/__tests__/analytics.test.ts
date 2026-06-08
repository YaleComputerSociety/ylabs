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

  it('declares one ascending timestamp index for TTL retention', () => {
    const ascendingTimestampIndexes = AnalyticsEvent.schema.indexes().filter(([fields]) => {
      const fieldNames = Object.keys(fields);
      return fieldNames.length === 1 && fields.timestamp === 1;
    });

    expect(ascendingTimestampIndexes).toHaveLength(1);
  });
});
