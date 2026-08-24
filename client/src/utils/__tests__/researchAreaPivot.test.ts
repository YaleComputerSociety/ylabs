import { describe, expect, it } from 'vitest';

import { buildResearchAreaFilterHref } from '../researchAreaPivot';

const readAreas = (href: string): string[] => {
  const params = new URLSearchParams(href.split('?')[1] || '');
  return (params.get('researchAreas') || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
};

describe('buildResearchAreaFilterHref', () => {
  it('builds a fresh single-area browse URL from an entity detail page', () => {
    const href = buildResearchAreaFilterHref(
      'Machine Learning',
      '/research/example-lab',
      '',
    );
    expect(href.startsWith('/research?')).toBe(true);
    expect(readAreas(href)).toEqual(['Machine Learning']);
  });

  it('replaces unrelated filters with a fresh pivot when not already area-browsing', () => {
    const href = buildResearchAreaFilterHref(
      'Neuroscience',
      '/research',
      'school=School+of+Medicine&department=Neurobiology',
    );
    const params = new URLSearchParams(href.split('?')[1]);
    expect(readAreas(href)).toEqual(['Neuroscience']);
    expect(params.get('school')).toBeNull();
    expect(params.get('department')).toBeNull();
  });

  it('appends to an existing area selection while browsing filtered areas', () => {
    const href = buildResearchAreaFilterHref(
      'Machine Learning',
      '/research',
      'researchAreas=Genomics&undergrad=1',
    );
    expect(readAreas(href)).toEqual(['Genomics', 'Machine Learning']);
    expect(new URLSearchParams(href.split('?')[1]).get('undergrad')).toBe('1');
  });

  it('does not duplicate an area that is already selected', () => {
    const href = buildResearchAreaFilterHref(
      'genomics',
      '/research',
      'researchAreas=Genomics',
    );
    expect(readAreas(href)).toEqual(['Genomics']);
  });

  it('pivots fresh when a text query is active even on the browse route', () => {
    const href = buildResearchAreaFilterHref(
      'Machine Learning',
      '/research',
      'q=proteins&researchAreas=Genomics',
    );
    expect(readAreas(href)).toEqual(['Machine Learning']);
  });

  it('pivots fresh when a department-label search is active on the browse route', () => {
    const href = buildResearchAreaFilterHref(
      'Machine Learning',
      '/research',
      'dept=Computer+Science&researchAreas=Genomics',
    );
    expect(readAreas(href)).toEqual(['Machine Learning']);
  });
});
