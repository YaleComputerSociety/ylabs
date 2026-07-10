import { describe, expect, it } from 'vitest';

import {
  getResearchEntityBestNextStep,
  getResearchEntityPathwaySummary,
  isItemOpen,
  BrowsableItem,
} from '../browsable';
import { ResearchEntity } from '../researchEntity';

const researchEntity = (overrides: Partial<ResearchEntity> = {}): ResearchEntity => ({
  _id: 'entity-1',
  slug: 'entity-1',
  name: 'Entity One',
  kind: 'lab',
  description: '',
  websiteUrl: '',
  location: '',
  departments: [],
  researchAreas: [],
  school: '',
  openness: 'open',
  typicalUndergradRoles: [],
  prerequisiteCourses: [],
  creditOptions: [],
  fundingPrograms: [],
  contactEmail: '',
  contactName: '',
  contactRole: '',
  sourceUrls: [],
  ...overrides,
});

describe('isItemOpen for research entities', () => {
  it('does not treat legacy openness as evidence-backed availability', () => {
    const item: BrowsableItem = {
      type: 'researchGroup',
      data: researchEntity({ openness: 'open' }),
    };

    expect(isItemOpen(item)).toBe(false);
  });

  it('uses accessSummary evidence for research availability', () => {
    const item: BrowsableItem = {
      type: 'researchGroup',
      data: researchEntity({
        openness: 'unknown',
        accessSummary: {
          status: 'posted-opening',
          confidence: 0.9,
          evidence: [],
          signalTypes: ['POSTED_OPENING'],
          entryPathwayTypes: ['POSTED_ROLE'],
          hasActivePostedOpportunity: true,
          bestNextStep: 'Apply through the official posting.',
        },
      }),
    };

    expect(isItemOpen(item)).toBe(true);
  });
});

describe('research entity pathway card summaries', () => {
  it('summarizes active posted opportunities first', () => {
    expect(
      getResearchEntityPathwaySummary(
        researchEntity({
          accessSummary: {
            status: 'posted-opening',
            confidence: 0.9,
            evidence: [],
            signalTypes: ['POSTED_OPENING'],
            entryPathwayTypes: ['COURSE_CREDIT'],
            hasActivePostedOpportunity: true,
            bestNextStep: 'Apply',
          },
        }),
      ),
    ).toBe('Posted opening available');
  });

  it('summarizes non-posted pathway types without formalization-only evidence', () => {
    expect(
      getResearchEntityPathwaySummary(
        researchEntity({
          accessSummary: {
            status: 'evidence-backed',
            confidence: 0.7,
            evidence: [],
            signalTypes: [],
            entryPathwayTypes: [
              'COURSE_CREDIT',
              'SENIOR_THESIS',
              'EXPLORATORY_CONTACT',
              'FELLOWSHIP_FUNDED_PROJECT',
            ],
            hasActivePostedOpportunity: false,
            bestNextStep: 'Plan exploratory outreach.',
          },
        }),
      ),
    ).toBe('Exploratory contact');
  });

  it('hides placeholder next steps from cards', () => {
    expect(
      getResearchEntityBestNextStep(
        researchEntity({
          accessSummary: {
            status: 'unknown',
            confidence: 0,
            evidence: [],
            signalTypes: [],
            entryPathwayTypes: [],
            hasActivePostedOpportunity: false,
            bestNextStep: 'Check back later',
          },
        }),
      ),
    ).toBeNull();
  });
});
