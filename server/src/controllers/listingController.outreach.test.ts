import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { buildListingOutreachEvent } from './listingController';
import { AnalyticsEventType } from '../models/analytics';

void describe('listing outreach analytics inputs', () => {
  void it('builds a privacy-safe contact attempt event', () => {
    const event = buildListingOutreachEvent({
      action: 'email_click',
      source: 'listing_detail_modal',
      contactCount: 2,
    });

    assert.deepEqual(event, {
      eventType: AnalyticsEventType.OUTREACH_CONTACT_ATTEMPT,
      metadata: {
        action: 'email_click',
        channel: 'email',
        source: 'listing_detail_modal',
        contactCount: 2,
      },
    });
    assert.equal(JSON.stringify(event).includes('@'), false);
  });

  void it('accepts only supported outreach outcomes', () => {
    assert.deepEqual(
      buildListingOutreachEvent({
        action: 'outcome',
        outcome: 'emailed',
        source: 'listing_detail_modal',
      }),
      {
        eventType: AnalyticsEventType.OUTREACH_OUTCOME,
        metadata: {
          action: 'outcome',
          channel: 'email',
          source: 'listing_detail_modal',
          contactCount: 0,
          outcome: 'emailed',
        },
      },
    );

    assert.equal(
      buildListingOutreachEvent({
        action: 'outcome',
        outcome: 'emailed ada@yale.edu',
      }),
      null,
    );
    assert.equal(buildListingOutreachEvent({ action: 'download_contacts' }), null);
  });
});
