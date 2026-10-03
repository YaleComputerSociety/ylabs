import { describe, expect, it } from 'vitest';

import { programsSearchHref, queryCarriesProgramsIntent } from '../researchProgramsHandoff';

describe('queryCarriesProgramsIntent', () => {
  it('recognizes a question about getting in rather than about a topic', () => {
    for (const query of [
      'research for freshmen with no experience',
      'Research for Freshmen',
      'paid summer research',
      'first-year research',
      'how do I get started in research',
      'beginner',
      'research for credit',
    ]) {
      expect(queryCarriesProgramsIntent(query)).toBe(true);
    }
  });

  it('leaves a research topic query alone', () => {
    for (const query of [
      'machine learning',
      'robotics research at yale',
      'credit markets',
      'neuroscience',
      'humanities',
      'experience sampling',
      '',
    ]) {
      expect(queryCarriesProgramsIntent(query)).toBe(false);
    }
  });
});

describe('programsSearchHref', () => {
  it('carries the typed query to the programs search', () => {
    expect(programsSearchHref('  research for freshmen ')).toBe(
      '/programs?q=research+for+freshmen',
    );
    expect(programsSearchHref('')).toBe('/programs');
  });
});
