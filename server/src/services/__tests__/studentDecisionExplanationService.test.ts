import { describe, expect, it } from 'vitest';

import {
  publicStudentDecisionExplanation,
  type StudentDecisionExplanation,
} from '../studentDecisionExplanationService';

const validExplanation: StudentDecisionExplanation = {
  recommendedAction: 'PLAN_EXPLORATORY_OUTREACH',
  headline: 'Plan careful exploratory outreach.',
  explanation:
    'This profile has source-backed evidence that outreach may be plausible, but no active posted role is attached.',
  why: ['The access evidence says students can reach out through the official profile.'],
  notThis: 'Not a posted opening.',
  confidence: 0.72,
  sourceUrls: ['https://medicine.yale.edu/profile/example'],
  reviewFlags: [],
};

const context = {
  sourceUrls: ['https://medicine.yale.edu/profile/example'],
  accessSignals: [
    {
      signalType: 'REACH_OUT_PLAUSIBLE',
      sourceUrl: 'https://medicine.yale.edu/profile/example',
      excerpt: 'Interested students may contact the lab through the official profile.',
    },
  ],
  entryPathways: [
    {
      pathwayType: 'EXPLORATORY_CONTACT',
      sourceUrls: ['https://medicine.yale.edu/profile/example'],
    },
  ],
  contactRoutes: [],
  postedOpportunities: [],
};

describe('publicStudentDecisionExplanation', () => {
  it('returns a source-backed student decision explanation when validation passes', () => {
    expect(publicStudentDecisionExplanation(validExplanation, context)).toEqual(
      expect.objectContaining({
        recommendedAction: 'PLAN_EXPLORATORY_OUTREACH',
        headline: 'Plan careful exploratory outreach.',
        notThis: 'Not a posted opening.',
        sourceUrls: ['https://medicine.yale.edu/profile/example'],
      }),
    );
  });

  it('rejects an apply recommendation without a posted opportunity or official application route', () => {
    expect(
      publicStudentDecisionExplanation(
        {
          ...validExplanation,
          recommendedAction: 'APPLY',
          headline: 'Apply now.',
        },
        context,
      ),
    ).toBeNull();
  });

  it('rejects invented source URLs', () => {
    expect(
      publicStudentDecisionExplanation(
        {
          ...validExplanation,
          sourceUrls: ['https://not-a-source.example/apply'],
        },
        context,
      ),
    ).toBeNull();
  });

  it('does not return unsafe source URLs even when they are present in context', () => {
    expect(
      publicStudentDecisionExplanation(
        {
          ...validExplanation,
          sourceUrls: ['mailto:hidden@example.edu', 'https://medicine.yale.edu/profile/example'],
        },
        {
          ...context,
          sourceUrls: ['mailto:hidden@example.edu', 'https://medicine.yale.edu/profile/example'],
        },
      )?.sourceUrls,
    ).toEqual(['https://medicine.yale.edu/profile/example']);
  });

  it('rejects public route recommendations that rely on unsafe URLs', () => {
    expect(
      publicStudentDecisionExplanation(
        {
          ...validExplanation,
          recommendedAction: 'OPEN_OFFICIAL_ROUTE',
          headline: 'Use the official route.',
        },
        {
          ...context,
          contactRoutes: [
            {
              routeType: 'OFFICIAL_APPLICATION',
              visibility: 'PUBLIC',
              url: 'javascript:alert(document.cookie)',
            },
          ],
        },
      ),
    ).toBeNull();
  });

  it('rejects public explanations that expose direct email addresses', () => {
    expect(
      publicStudentDecisionExplanation(
        {
          ...validExplanation,
          explanation: 'Email example.faculty@yale.edu to ask for a role.',
        },
        context,
      ),
    ).toBeNull();
  });

  it('rejects not-this copy that names a recommended action as the thing to do', () => {
    expect(
      publicStudentDecisionExplanation(
        {
          ...validExplanation,
          notThis: 'APPLY, because there are no active posted opportunities.',
        },
        context,
      ),
    ).toBeNull();
  });
});
