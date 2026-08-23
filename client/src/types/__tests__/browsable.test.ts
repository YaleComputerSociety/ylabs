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

  it('collapses an entry-mode chip already implied by the student-facing category', () => {
    const labels = getItemTags(
      fellowshipItem({
        studentFacingCategory: 'Faculty matching program',
        entryMode: 'DIRECT_FACULTY_MATCHING',
      }),
      neutralColor,
    ).map((t) => t.label);
    expect(labels).toContain('Faculty matching program');
    expect(labels).not.toContain('Faculty matching');
  });

  it('drops exact duplicate labels across facets', () => {
    const labels = getItemTags(
      fellowshipItem({ studentFacingCategory: 'Research', purpose: ['Research'] }),
      neutralColor,
    ).map((t) => t.label);
    expect(labels.filter((label) => label === 'Research')).toHaveLength(1);
  });

  it('keeps a Graduate chip when the category merely shares the substring', () => {
    const labels = getItemTags(
      fellowshipItem({
        undergraduateOnly: false,
        studentFacingCategory: 'Undergraduate research funding',
      }),
      neutralColor,
    ).map((t) => t.label);
    expect(labels).toContain('Graduate');
    expect(labels).toContain('Undergraduate research funding');
  });

  it('keeps a distinct year-of-study chip alongside an unrelated longer category label', () => {
    const labels = getItemTags(
      fellowshipItem({
        studentFacingCategory: 'Senior research funding',
        yearOfStudy: ['Senior'],
      }),
      neutralColor,
    ).map((t) => t.label);
    expect(labels).toContain('Senior');
    expect(labels).toContain('Senior research funding');
  });
});

describe('isItemOpen for research entities', () => {
  it('does not treat an entity without access evidence as available', () => {
    const item: BrowsableItem = {
      type: 'researchGroup',
      data: researchEntity({}),
    };

    expect(isItemOpen(item)).toBe(false);
  });

  it('uses accessSummary evidence for research availability', () => {
    const item: BrowsableItem = {
      type: 'researchGroup',
      data: researchEntity({
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
