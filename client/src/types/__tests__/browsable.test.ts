import { describe, expect, it } from 'vitest';

import { getItemTags, BrowsableItem } from '../browsable';
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

describe('getItemTags fellowship audience', () => {
  it('labels graduate-only programs with a Graduate tag', () => {
    const tags = getItemTags(fellowshipItem({ undergraduateOnly: false }));
    expect(tags.map((t) => t.label)).toContain('Graduate');
  });

  it('does not add a Graduate tag for undergraduate or unknown-audience programs', () => {
    expect(
      getItemTags(fellowshipItem({ undergraduateOnly: true })).map((t) => t.label),
    ).not.toContain('Graduate');
    expect(
      getItemTags(fellowshipItem({ undergraduateOnly: null })).map((t) => t.label),
    ).not.toContain('Graduate');
  });

  it('collapses an entry-mode chip already implied by the student-facing category', () => {
    const labels = getItemTags(
      fellowshipItem({
        studentFacingCategory: 'Faculty matching program',
        entryMode: 'DIRECT_FACULTY_MATCHING',
      }),
    ).map((t) => t.label);
    expect(labels).toContain('Faculty matching program');
    expect(labels).not.toContain('Faculty matching');
  });

  it('drops exact duplicate labels across facets', () => {
    const labels = getItemTags(
      fellowshipItem({ studentFacingCategory: 'Research', purpose: ['Research'] }),
    ).map((t) => t.label);
    expect(labels.filter((label) => label === 'Research')).toHaveLength(1);
  });

  it('keeps a Graduate chip when the category merely shares the substring', () => {
    const labels = getItemTags(
      fellowshipItem({
        undergraduateOnly: false,
        studentFacingCategory: 'Undergraduate research funding',
      }),
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
    ).map((t) => t.label);
    expect(labels).toContain('Senior');
    expect(labels).toContain('Senior research funding');
  });
});
