import { describe, expect, it } from 'vitest';

import { getResearchEntityBestNextStep, getItemTags, isItemOpen, BrowsableItem } from '../browsable';
import { ResearchEntity } from '../researchEntity';
import { Fellowship } from '../types';

const fellowshipItem = (overrides: Partial<Fellowship> = {}): BrowsableItem => ({
  type: 'fellowship',
  data: {
    studentFacingCategory: 'Fellowship funding',
    entryMode: '',
    yearOfStudy: [],
    purpose: [],
    ...overrides,
  } as Fellowship,
});

const neutralColor = () => ({ bg: 'bg-gray-50', text: 'text-gray-700' });

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

describe('getItemTags fellowship audience', () => {
  it('labels graduate-only programs with a Graduate tag', () => {
    const tags = getItemTags(fellowshipItem({ undergraduateOnly: false }), neutralColor);
    expect(tags.map((t) => t.label)).toContain('Graduate');
  });

  it('does not add a Graduate tag for undergraduate or unknown-audience programs', () => {
    expect(
      getItemTags(fellowshipItem({ undergraduateOnly: true }), neutralColor).map((t) => t.label),
    ).not.toContain('Graduate');
    expect(
      getItemTags(fellowshipItem({ undergraduateOnly: null }), neutralColor).map((t) => t.label),
    ).not.toContain('Graduate');
  });
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
          bestNextStep: 'Apply through the official posting.',
        },
      }),
    };

    expect(isItemOpen(item)).toBe(true);
  });
});

describe('research entity best next step', () => {
  it('hides placeholder next steps from cards', () => {
    expect(
      getResearchEntityBestNextStep(
        researchEntity({
          accessSummary: {
            status: 'unknown',
            confidence: 0,
            evidence: [],
            signalTypes: [],
            bestNextStep: 'Check back later',
          },
        }),
      ),
    ).toBeNull();
  });
});
