import { describe, expect, it } from 'vitest';
import {
  getBestNextStepCategory,
  pathwayBestNextStepCategories,
} from '../pathwaySearchService';

describe('pathwaySearchService', () => {
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
});
